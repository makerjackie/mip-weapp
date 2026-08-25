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
import {
  buildOwnerCandidateQuery,
  buildOwnerRoleUpsertQuery,
  buildOwnerVerificationQuery,
  currentAgreementVersions,
  resolveOwnerPhoneHash,
  selectOwnerCandidateId,
} from './lib/mip-owner-bootstrap.mjs'

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

const agreements = currentAgreementVersions(env.MIP_AGREEMENTS_JSON)
const phoneHash = resolveOwnerPhoneHash({
  appId,
  ownerPhone: env.MIP_OWNER_PHONE,
  phoneEncryptionKey: env.MIP_PHONE_ENCRYPTION_KEY,
})
const ownerCandidateOptions = {
  agreements,
  appId,
  demoUserIds: [...demoUserIds],
  phoneHash,
}

bindAndRequireMysqlEnvironment(root, envId)
const candidates = callOwnerCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerCandidateQuery({ ...ownerCandidateOptions, userId }),
  limit: 2,
}, 'MIP owner candidate lookup failed')
const selectedUserId = selectOwnerCandidateId(candidates, userId)
const selectedOwnerOptions = {
  ...ownerCandidateOptions,
  userId: selectedUserId,
}

const upsert = callOwnerCloudbase('manageMysqlDatabase', {
  action: 'runStatement',
  sql: buildOwnerRoleUpsertQuery(selectedOwnerOptions),
}, 'MIP owner role bootstrap failed')
if (upsert?.success === false) {
  throw new Error('MIP owner role bootstrap failed')
}

const verification = callOwnerCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerVerificationQuery(selectedOwnerOptions),
}, 'MIP owner role verification failed')
const ownerCount = Number(collectFieldValues(verification, ['ownerCount', 'owner_count'])[0])
if (ownerCount !== 1) {
  throw new Error('MIP owner role verification failed')
}

const audit = callOwnerCloudbase('manageMysqlDatabase', {
  action: 'runStatement',
  sql: `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (
      ${sqlLiteral(appId)}, ${sqlLiteral(selectedUserId)}, 'ADMIN', 'PLATFORM', NULL,
      'admin.owner.bootstrap', 'admin_role_binding', ${sqlLiteral(selectedUserId)},
      'PLATFORM_OWNER', ${sqlJson({ source: 'owner-bootstrap' })}
    )`,
}, 'MIP owner audit write failed')
if (audit?.success === false) {
  throw new Error('MIP owner audit write failed')
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

function callOwnerCloudbase(tool, args, errorMessage) {
  try {
    return callCloudbase(root, tool, args)
  }
  catch {
    throw new Error(errorMessage)
  }
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
