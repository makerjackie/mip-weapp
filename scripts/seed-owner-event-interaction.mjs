#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  buildOwnerCandidateQuery,
  currentAgreementVersions,
  resolveOwnerPhoneHash,
  selectOwnerCandidateId,
} from './lib/mip-owner-bootstrap.mjs'
import {
  buildOwnerInteractionInsertQuery,
  buildOwnerInteractionPreflightQuery,
  buildOwnerInteractionVerificationQuery,
  ownerInteractionFixtureSummary,
  resolveOwnerInteractionFixtureCommand,
} from './lib/mip-owner-event-interaction-fixture.mjs'
import { assertSeedSqlScope } from './lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const validateOnly = process.argv.includes('--validate-only')
const command = resolveOwnerInteractionFixtureCommand({
  args: process.argv.slice(2),
  env,
})
const seed = JSON.parse(fs.readFileSync(
  path.join(root, 'database', 'mysql', 'mip', 'seed.demo.json'),
  'utf8',
))
const demoUserIds = (Array.isArray(seed?.users) ? seed.users : [])
  .map(item => String(item?.id || ''))
  .filter(Boolean)

if (validateOnly) {
  const fakeOwnerUserId = '70000000-0000-4000-8000-000000000001'
  const statements = [buildOwnerInteractionInsertQuery({
    appId: command.appId,
    eventId: command.eventId,
    registrationId: command.registrationId,
    ownerUserId: fakeOwnerUserId,
  })]
  assertSeedSqlScope(statements)
  console.log(JSON.stringify({ valid: true, stagingConfirmed: command.stagingConfirmed, writeStatements: statements.length }))
  process.exit(0)
}

const phoneHash = resolveOwnerPhoneHash({
  appId: command.appId,
  ownerPhone: env.MIP_OWNER_PHONE,
  phoneEncryptionKey: env.MIP_PHONE_ENCRYPTION_KEY,
})
const agreements = currentAgreementVersions(env.MIP_AGREEMENTS_JSON)

bindAndRequireMysqlEnvironment(root, command.envId, {
  development: ['development', 'test'].includes(command.stage),
  stage: command.stage,
})
assertTablesExist(['mip_users', 'mip_profiles', 'mip_private_profiles', 'mip_agreement_acceptances', 'mip_app_settings', 'mip_events', 'mip_event_registrations'])

const candidates = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerCandidateQuery({
    agreements,
    appId: command.appId,
    demoUserIds,
    phoneHash,
  }),
  limit: 2,
}, 'Owner candidate lookup failed')
const ownerUserId = selectOwnerCandidateId(candidates)

const preflight = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerInteractionPreflightQuery({
    appId: command.appId,
    eventId: command.eventId,
    registrationId: command.registrationId,
    ownerUserId,
  }),
}, 'Owner event interaction fixture preflight failed')
const preflightRow = findRow(preflight, [
  'eventCrossApp',
  'eventSameApp',
  'eventReadyRows',
  'fixedRegistrationRows',
  'ownerEventRows',
])
if (!preflightRow) {
  throw new Error('Owner event interaction fixture preflight returned no row')
}
const preflightCounts = numericFields(preflightRow)
if (preflightCounts.eventCrossApp > 0) {
  throw new Error('Owner event interaction fixture event belongs to another AppID')
}
if (preflightCounts.eventSameApp !== 1) {
  throw new Error('Demo interaction event is missing from the confirmed AppID')
}
if (preflightCounts.eventReadyRows !== 1) {
  throw new Error('Demo interaction event does not match the fixed ended READY demo fixture; no write was attempted')
}
if (preflightCounts.ownerEventRows !== 0) {
  throw new Error('Owner already has a registration for the demo interaction event; no write was attempted')
}
if (preflightCounts.fixedRegistrationRows !== 0) {
  throw new Error('Fixed registration ID is already occupied; no write was attempted')
}

const statement = buildOwnerInteractionInsertQuery({
  appId: command.appId,
  eventId: command.eventId,
  registrationId: command.registrationId,
  ownerUserId,
})
assertSeedSqlScope([statement])
const result = callFixtureCloudbase('manageMysqlDatabase', {
  action: 'runStatement',
  sql: statement,
}, 'Owner event interaction fixture write failed')
if (result?.success === false) {
  throw new Error('Owner event interaction fixture write failed')
}

const verification = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerInteractionVerificationQuery({
    appId: command.appId,
    eventId: command.eventId,
    registrationId: command.registrationId,
    ownerUserId,
  }),
}, 'Owner event interaction fixture verification failed')
const verificationRow = findRow(verification, ['ready'])
const summary = ownerInteractionFixtureSummary({
  ready: Number(verificationRow?.ready),
})
console.log(JSON.stringify({ ...summary, wrote: true }, null, 2))

function assertTablesExist(tableNames) {
  const response = callFixtureCloudbase('queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${tableNames.map(table => `'${table}'`).join(', ')})`,
  }, 'MIP event interaction fixture table preflight failed')
  const found = new Set(collectFieldValues(response, ['tableName', 'table_name']))
  const missing = tableNames.filter(table => !found.has(table))
  if (missing.length) {
    throw new Error(`Apply MIP migrations before creating the event interaction fixture; missing table ${missing[0]}`)
  }
}

function callFixtureCloudbase(tool, args, errorMessage) {
  try {
    return callCloudbase(root, tool, args, 300000)
  }
  catch {
    throw new Error(errorMessage)
  }
}

function findRow(value, keys) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)) {
    const lowerKeys = new Set(Object.keys(value).map(key => key.toLowerCase()))
    if (keys.some(key => lowerKeys.has(key.toLowerCase()))) {
      return value
    }
    for (const child of Object.values(value)) {
      const found = findRow(child, keys)
      if (found) {
        return found
      }
    }
    return null
  }
  for (const child of value) {
    const found = findRow(child, keys)
    if (found) {
      return found
    }
  }
  return null
}

function numericFields(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]))
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
    if (expected.has(key.toLowerCase()) && typeof child === 'string') {
      output.push(child)
    }
    else if (child && typeof child === 'object') {
      collectFieldValues(child, names, output)
    }
  }
  return output
}
