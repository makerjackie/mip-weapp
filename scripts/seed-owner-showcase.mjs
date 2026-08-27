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
  buildOwnerShowcaseBadgeEquipmentInsert,
  buildOwnerShowcaseBadgeInsert,
  buildOwnerShowcaseBadgeProfileInsert,
  buildOwnerShowcaseEventOrderInsert,
  buildOwnerShowcasePreflightQuery,
  buildOwnerShowcaseRegistrationInsert,
  buildOwnerShowcaseStateQuery,
  buildOwnerShowcaseTaskAssignmentInsert,
  OWNER_SHOWCASE_BADGES,
  OWNER_SHOWCASE_EVENTS,
  OWNER_SHOWCASE_PAID_EVENT,
  OWNER_SHOWCASE_TASK_ASSIGNMENTS,
  ownerShowcaseFixtureSummary,
  resolveOwnerShowcaseCommand,
} from './lib/mip-owner-showcase-fixture.mjs'
import { assertSeedSqlScope } from './lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const validateOnly = process.argv.includes('--validate-only')
const command = resolveOwnerShowcaseCommand({ args: process.argv.slice(2), env })
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8'))
const demoUserIds = (Array.isArray(seed?.users) ? seed.users : [])
  .map(item => String(item?.id || ''))
  .filter(Boolean)

if (validateOnly) {
  const fakeOwnerUserId = '70000000-0000-4000-8000-000000000001'
  const statements = [
    buildOwnerShowcaseEventOrderInsert({ appId: command.appId, ownerUserId: fakeOwnerUserId }),
    ...[...OWNER_SHOWCASE_EVENTS, OWNER_SHOWCASE_PAID_EVENT].map(item => buildOwnerShowcaseRegistrationInsert({
      appId: command.appId,
      ownerUserId: fakeOwnerUserId,
      ...item,
    })),
    ...OWNER_SHOWCASE_BADGES.map(badge => buildOwnerShowcaseBadgeInsert({
      appId: command.appId,
      ownerUserId: fakeOwnerUserId,
      badge,
    })),
    buildOwnerShowcaseBadgeProfileInsert({ appId: command.appId, ownerUserId: fakeOwnerUserId }),
    ...OWNER_SHOWCASE_BADGES.map(badge => buildOwnerShowcaseBadgeEquipmentInsert({
      appId: command.appId,
      ownerUserId: fakeOwnerUserId,
      badge,
    })),
    ...OWNER_SHOWCASE_TASK_ASSIGNMENTS.map(assignment => buildOwnerShowcaseTaskAssignmentInsert({
      appId: command.appId,
      ownerUserId: fakeOwnerUserId,
      assignment,
    })),
  ]
  assertSeedSqlScope(statements)
  console.log(JSON.stringify({ valid: true, developmentOnly: true, writeStatements: statements.length }))
  process.exit(0)
}

const phoneHash = resolveOwnerPhoneHash({
  appId: command.appId,
  ownerPhone: env.MIP_OWNER_PHONE,
  phoneEncryptionKey: env.MIP_PHONE_ENCRYPTION_KEY,
})
const agreements = currentAgreementVersions(env.MIP_AGREEMENTS_JSON)
bindAndRequireMysqlEnvironment(root, command.envId, { development: true, stage: command.stage })
assertTablesExist([
  'mip_users',
  'mip_profiles',
  'mip_private_profiles',
  'mip_agreement_acceptances',
  'mip_events',
  'mip_event_registrations',
  'mip_orders',
  'mip_badges',
  'mip_user_badges',
  'mip_user_badge_profiles',
  'mip_user_badge_equipment',
  'mip_task_cards',
  'mip_task_assignments',
])

const candidates = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerCandidateQuery({ agreements, appId: command.appId, demoUserIds, phoneHash }),
  limit: 2,
}, 'Owner candidate lookup failed')
const ownerUserId = selectOwnerCandidateId(candidates)
const preflight = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerShowcasePreflightQuery({ appId: command.appId, ownerUserId }),
}, 'Owner showcase fixture preflight failed')
const preflightRow = findRow(preflight, ['eventSameApp', 'eventCrossApp', 'activeBadgeRows', 'activeTaskRows'])
if (!preflightRow) {
  throw new Error('Owner showcase fixture preflight returned no row')
}
const counts = numericFields(preflightRow)
if (counts.eventSameApp !== OWNER_SHOWCASE_EVENTS.length + 1 || counts.eventCrossApp > 0
  || counts.registrationCrossApp > 0 || counts.eventOrderCrossApp > 0
  || counts.activeBadgeRows !== OWNER_SHOWCASE_BADGES.length
  || counts.badgeCrossApp > 0 || counts.awardCrossApp > 0
  || counts.activeTaskRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length
  || counts.taskCrossApp > 0 || counts.taskAssignmentCrossApp > 0) {
  throw new Error('Owner showcase fixture identities or required demo facts are not in the confirmed AppID')
}
if (counts.ownerEventRows > 0 && counts.ownerEventRows !== counts.registeredRows) {
  throw new Error('Owner already has a conflicting registration for a showcase event; no write was attempted')
}
if (counts.fixedRegistrationRows > 0 && counts.registeredRows !== counts.fixedRegistrationRows) {
  throw new Error('Fixed showcase registration exists with an unexpected status; no write was attempted')
}
if (![0, OWNER_SHOWCASE_EVENTS.length].includes(counts.fixedFreeRegistrationRows)
  || (counts.fixedFreeRegistrationRows > 0 && counts.fixedFreeRegistrationRows !== OWNER_SHOWCASE_EVENTS.length)) {
  throw new Error('Showcase free-event registrations are partially present; no write was attempted')
}
if (counts.paidRegisteredRows > 0 && counts.paidRegisteredRows !== 1) {
  throw new Error('Showcase paid-event registration has an unexpected status; no write was attempted')
}
if (counts.fixedEventOrderRows > 0 && counts.paidEventOrderRows !== counts.fixedEventOrderRows) {
  throw new Error('Fixed showcase event order exists with an unexpected status or TEST snapshot; no write was attempted')
}
if (counts.activeAwardRows !== counts.fixedAwardRows && counts.fixedAwardRows > 0) {
  throw new Error('Fixed showcase badge award exists with an unexpected status; no write was attempted')
}
if (counts.equipmentRows !== counts.equipmentBadgeRows) {
  throw new Error('Showcase badge equipment has a conflicting slot or badge; no write was attempted')
}
if (counts.ownerTaskAssignmentRows > 0
  && (counts.ownerTaskAssignmentRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length
    || counts.activeTaskAssignmentRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length
    || counts.fixedTaskAssignmentRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length)) {
  throw new Error('Owner already has a conflicting showcase task assignment; no write was attempted')
}
if (counts.fixedTaskAssignmentRows > 0
  && (counts.fixedTaskAssignmentRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length
    || counts.activeTaskAssignmentRows !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length)) {
  throw new Error('Fixed showcase task assignment exists with an unexpected status; no write was attempted')
}

const statements = []
if (counts.fixedEventOrderRows === 0) {
  statements.push(buildOwnerShowcaseEventOrderInsert({ appId: command.appId, ownerUserId }))
}
if (counts.fixedRegistrationRows === 0) {
  statements.push(...[...OWNER_SHOWCASE_EVENTS, OWNER_SHOWCASE_PAID_EVENT].map(item => buildOwnerShowcaseRegistrationInsert({
    appId: command.appId,
    ownerUserId,
    ...item,
  })))
}
else if (counts.paidRegisteredRows === 0) {
  statements.push(buildOwnerShowcaseRegistrationInsert({
    appId: command.appId,
    ownerUserId,
    ...OWNER_SHOWCASE_PAID_EVENT,
  }))
}
if (counts.fixedAwardRows === 0) {
  statements.push(...OWNER_SHOWCASE_BADGES.map(badge => buildOwnerShowcaseBadgeInsert({
    appId: command.appId,
    ownerUserId,
    badge,
  })))
}
if (counts.badgeProfileRows === 0) {
  statements.push(buildOwnerShowcaseBadgeProfileInsert({ appId: command.appId, ownerUserId }))
}
if (counts.equipmentRows === 0) {
  statements.push(...OWNER_SHOWCASE_BADGES.map(badge => buildOwnerShowcaseBadgeEquipmentInsert({
    appId: command.appId,
    ownerUserId,
    badge,
  })))
}
if (counts.fixedTaskAssignmentRows === 0) {
  statements.push(...OWNER_SHOWCASE_TASK_ASSIGNMENTS.map(assignment => buildOwnerShowcaseTaskAssignmentInsert({
    appId: command.appId,
    ownerUserId,
    assignment,
  })))
}
if (statements.length > 0) {
  assertSeedSqlScope(statements)
  for (const statement of statements) {
    const result = callFixtureCloudbase('manageMysqlDatabase', { action: 'runStatement', sql: statement }, 'Owner showcase fixture write failed')
    if (result?.success === false) {
      throw new Error('Owner showcase fixture write failed')
    }
  }
}

const verification = callFixtureCloudbase('queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerShowcaseStateQuery({ appId: command.appId, ownerUserId }),
}, 'Owner showcase fixture verification failed')
const state = numericFields(findRow(verification, ['registeredEvents', 'paidEventOrders', 'activeBadges', 'assignedTasks']) || {})
console.log(JSON.stringify(ownerShowcaseFixtureSummary({ ...state, wrote: statements.length }), null, 2))

function assertTablesExist(tableNames) {
  const response = callFixtureCloudbase('queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (${tableNames.map(table => `'${table}'`).join(', ')})`,
  }, 'MIP owner showcase table preflight failed')
  const found = new Set(collectFieldValues(response, ['tableName', 'table_name']))
  const missing = tableNames.filter(table => !found.has(table))
  if (missing.length) {
    throw new Error(`Apply MIP migrations before creating the owner showcase fixture; missing table ${missing[0]}`)
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
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findRow(child, keys)
      if (found) {
        return found
      }
    }
    return null
  }
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

function numericFields(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]))
}

function collectFieldValues(value, names, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectFieldValues(item, names, output))
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
