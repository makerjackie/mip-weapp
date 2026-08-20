#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const appId = env.MINI_PROGRAM_APP_ID
const profileId = process.argv.find(value => value.startsWith('--profile-id='))?.slice('--profile-id='.length)

if (!process.argv.includes('--confirm-owner') || !envId || !appId) {
  throw new Error('Owner bootstrap requires --confirm-owner and configured EnvID/AppID')
}
if (profileId && !/^[0-9a-f-]{36}$/i.test(profileId)) {
  throw new Error('Invalid --profile-id UUID')
}

bindAndRequireMysqlEnvironment(root, envId)
const filter = profileId ? `and id = ${sqlLiteral(profileId)}` : ''
const candidates = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `select id, user_id from member_profiles
    where app_id = ${sqlLiteral(appId)} and is_demo = 0
      and user_id is not null and user_id <> '' ${filter}
    order by updated_at desc limit 2`,
  limit: 2,
})

function rows(value) {
  if (Array.isArray(value)) {
    return value
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  for (const child of Object.values(value)) {
    const found = rows(child)
    if (found.length) {
      return found
    }
  }
  return []
}

const profiles = rows(candidates).filter(item => item && typeof item === 'object' && item.id && item.user_id)
if (profiles.length !== 1) {
  throw new Error(profileId
    ? 'The selected real profile was not found'
    : 'Expected exactly one real profile; rerun with --profile-id=<profile UUID>')
}
const selected = profiles[0]
callCloudbase(root, 'manageMysqlDatabase', {
  action: 'runStatement',
  sql: `insert into member_admin_roles (app_id, user_id, role, status)
    values (${sqlLiteral(appId)}, ${sqlLiteral(selected.user_id)}, 'owner', 'ACTIVE')
    on duplicate key update
      role = 'owner', status = 'ACTIVE', updated_at = UTC_TIMESTAMP(3)`,
})
const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `select count(*) as owner_count from member_admin_roles
    where app_id = ${sqlLiteral(appId)} and user_id = ${sqlLiteral(selected.user_id)}
      and role = 'owner' and status = 'ACTIVE'`,
})
if (!JSON.stringify(verification).includes('1')) {
  throw new Error('Owner role verification failed')
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'bootstrap-owner-result.json'), `${JSON.stringify({
  environmentVerified: true,
  role: 'owner',
  ownerCount: 1,
  bootstrappedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[admin-bootstrap] owner role verified; OpenID was not printed or persisted locally')
