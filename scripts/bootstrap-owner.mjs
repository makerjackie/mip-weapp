#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlJson,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const root = path.resolve(import.meta.dirname, '..')
const demoSeed = JSON.parse(fs.readFileSync(path.join(root, 'database', 'mysql', 'mip', 'seed.demo.json'), 'utf8'))
const demoUserIds = new Set((Array.isArray(demoSeed?.users) ? demoSeed.users : [])
  .map(item => String(item?.id || ''))
  .filter(isUuid))
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const userId = argumentValue('--user-id=')
const confirmedEnv = argumentValue('--confirm-env=')

if (!process.argv.includes('--confirm-owner') || !envId || confirmedEnv !== envId) {
  throw new Error('MIP owner bootstrap requires --confirm-owner and --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('MINI_PROGRAM_APP_ID is invalid')
}
if (userId && !isUuid(userId)) {
  throw new Error('Invalid --user-id UUID')
}
if (userId && demoUserIds.has(userId)) {
  throw new Error('Demo seed users cannot become platform owners')
}
const allowedAppIds = String(env.MIP_ALLOWED_APP_IDS || appId)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
if (!allowedAppIds.includes(appId)) {
  throw new Error('MIP_ALLOWED_APP_IDS must include MINI_PROGRAM_APP_ID')
}

bindAndRequireMysqlEnvironment(root, envId)
const filter = userId ? `AND u.id = ${sqlLiteral(userId)}` : ''
const localDemoFilter = demoUserIds.size
  ? `AND u.id NOT IN (${[...demoUserIds].map(sqlLiteral).join(', ')})`
  : ''
const candidates = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT u.id, p.nickname
    FROM mip_users u
    INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
    WHERE u.app_id = ${sqlLiteral(appId)} AND u.status = 'ACTIVE'
      ${filter}
      ${localDemoFilter}
      AND NOT EXISTS (
        SELECT 1
        FROM mip_app_settings demo_manifest
        WHERE demo_manifest.app_id = u.app_id
          AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
          AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
          AND JSON_SEARCH(
            JSON_EXTRACT(demo_manifest.value_json, '$.recordIds.users'),
            'one', u.id
          ) IS NOT NULL
      )
    ORDER BY p.updated_at DESC, u.id
    LIMIT 2`,
  limit: 2,
})
const users = findRows(candidates).filter(item => isUuid(item?.id) && typeof item?.nickname === 'string')
if (users.length !== 1) {
  throw new Error(userId
    ? 'The selected active MIP user profile was not found'
    : 'Expected exactly one active MIP profile; rerun with --user-id=<user UUID>')
}
const selectedUserId = users[0].id

const upsert = callCloudbase(root, 'manageMysqlDatabase', {
  action: 'runStatement',
  sql: `INSERT INTO mip_admin_role_bindings (
      id, app_id, user_id, scope_type, scope_id, role_key, status,
      granted_by_user_id, granted_at, revoked_at
    ) VALUES (
      UUID(), ${sqlLiteral(appId)}, ${sqlLiteral(selectedUserId)}, 'PLATFORM',
      ${sqlLiteral(PLATFORM_SCOPE_ID)}, 'PLATFORM_OWNER', 'ACTIVE',
      ${sqlLiteral(selectedUserId)}, UTC_TIMESTAMP(3), NULL
    ) ON DUPLICATE KEY UPDATE
      status = 'ACTIVE', granted_by_user_id = VALUES(granted_by_user_id),
      granted_at = UTC_TIMESTAMP(3), revoked_at = NULL`,
})
if (upsert?.success === false) {
  throw new Error('MIP owner role bootstrap failed')
}

callCloudbase(root, 'manageMysqlDatabase', {
  action: 'runStatement',
  sql: `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (
      ${sqlLiteral(appId)}, ${sqlLiteral(selectedUserId)}, 'ADMIN', 'PLATFORM', NULL,
      'admin.owner.bootstrap', 'admin_role_binding', ${sqlLiteral(selectedUserId)},
      'PLATFORM_OWNER', ${sqlJson({ source: 'owner-bootstrap' })}
    )`,
})

const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT COUNT(*) AS ownerCount
    FROM mip_admin_role_bindings
    WHERE app_id = ${sqlLiteral(appId)}
      AND user_id = ${sqlLiteral(selectedUserId)}
      AND scope_type = 'PLATFORM'
      AND scope_id = ${sqlLiteral(PLATFORM_SCOPE_ID)}
      AND role_key = 'PLATFORM_OWNER'
      AND status = 'ACTIVE'`,
})
const ownerCount = Number(collectFieldValues(verification, ['ownerCount', 'owner_count'])[0])
if (ownerCount !== 1) {
  throw new Error('MIP owner role verification failed')
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'bootstrap-owner-result.json'), `${JSON.stringify({
  environmentVerified: true,
  role: 'PLATFORM_OWNER',
  scope: 'PLATFORM',
  ownerCount,
  bootstrappedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[mip-admin-bootstrap] platform owner verified; AppID, user identity, and environment ID were not persisted')

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function findRows(value) {
  if (!value || typeof value !== 'object') {
    return []
  }
  if (Array.isArray(value)) {
    if (value.some(item => item
      && typeof item === 'object'
      && 'id' in item
      && 'nickname' in item)) {
      return value
    }
    for (const item of value) {
      const found = findRows(item)
      if (found.length) {
        return found
      }
    }
    return []
  }
  for (const child of Object.values(value)) {
    const found = findRows(child)
    if (found.length) {
      return found
    }
  }
  return []
}

function collectFieldValues(value, names, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldValues(item, names, output)
    }
    return output
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && ['string', 'number', 'bigint'].includes(typeof child)) {
      output.push(String(child))
    }
    else if (child && typeof child === 'object') {
      collectFieldValues(child, names, output)
    }
  }
  return output
}
