#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const appId = env.MINI_PROGRAM_APP_ID
const paymentMode = env.MEMBERSHIP_PAYMENT_MODE || 'disabled'
const paymentFunction = env.MEMBERSHIP_PAY_FUNCTION_NAME || 'membership-cloudpay'
const paymentCallbackFunction = env.MEMBERSHIP_PAY_CALLBACK_FUNCTION || 'membership-cloudpay-callback'
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!envId || !appId || confirmedEnv !== envId) {
  throw new Error('Cloud verification requires configured EnvID/AppID and --confirm-env=<exact EnvID>')
}
bindAndRequireMysqlEnvironment(root, envId)

// Keep each response below the MCP 64 KiB transport ceiling. The CloudBase
// payload includes both normalized rows and a raw copy, so a single large
// listFunctions response can otherwise be truncated and become invalid JSON.
const functionInventory = []
for (let offset = 0; offset < 100; offset += 4) {
  const page = callCloudbase(root, 'queryFunctions', {
    action: 'listFunctions',
    limit: 4,
    offset,
  })
  functionInventory.push(page)
  const text = JSON.stringify(page)
  const totalMatch = text.match(/"totalCount"\s*:\s*(\d+)/i)
  if (totalMatch && offset + 4 >= Number(totalMatch[1])) {
    break
  }
}

function hasActiveFunction(value, functionName) {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (!Array.isArray(value)) {
    const name = value.FunctionName || value.functionName || value.Name || value.name
    const status = value.Status || value.status
    if (name === functionName && status === 'Active') {
      return true
    }
  }
  return Object.values(value).some(child => hasActiveFunction(child, functionName))
}

const tableCounts = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `select
    (select count(*) from member_plans where app_id = ${sqlLiteral(appId)}) as plans,
    (select count(*) from member_profiles where app_id = ${sqlLiteral(appId)}) as profiles,
    (select count(*) from member_events where app_id = ${sqlLiteral(appId)}) as events,
    (select count(*) from member_event_managers where app_id = ${sqlLiteral(appId)}) as eventManagers,
    (select count(*) from member_follows where app_id = ${sqlLiteral(appId)}) as follows,
    (select count(*) from member_event_photos where app_id = ${sqlLiteral(appId)}) as eventPhotos,
    (select count(*)
       from member_events event
       where event.app_id = ${sqlLiteral(appId)}
         and exists (
           select 1 from member_audit_logs creator
           where creator.app_id = event.app_id
             and creator.resource_type = 'event'
             and creator.resource_id = event.id
             and creator.action in ('EVENT_CREATED', 'EVENT_DUPLICATED')
         )
         and not exists (
           select 1 from member_event_managers owner
           where owner.app_id = event.app_id
             and owner.event_id = event.id
             and owner.role = 'EVENT_OWNER'
             and owner.status = 'ACTIVE'
         )
    ) as eventsWithoutOwner,
    (select count(*) from member_notifications where app_id = ${sqlLiteral(appId)}) as notifications,
    (select count(*) from member_notification_outbox where app_id = ${sqlLiteral(appId)}) as notificationOutbox,
    (select count(*) from member_operational_failures where app_id = ${sqlLiteral(appId)}) as operationalFailures`,
})
const tableCountRow = tableCounts?.data?.rows?.[0]
if (!tableCountRow || Number(tableCountRow.eventsWithoutOwner) !== 0) {
  throw new Error('Cloud verification found created or duplicated events without an active owner')
}

const functions = []
for (const functionName of [
  'membership-api',
  'membership-admin-api',
  'membership-payment-ledger',
  'membership-notification-worker',
]) {
  const health = callCloudbase(root, 'manageFunctions', {
    action: 'invokeFunction',
    functionName,
    params: { action: 'health' },
  })
  const healthResult = cloudFunctionResult(health)
  const invocation = health?.data?.invokeResult || health?.data?.raw
  const hasInvocationEvidence = typeof invocation?.RequestId === 'string'
    && invocation.RequestId.length > 0
    && typeof invocation?.Log === 'string'
  if (!hasInvocationEvidence
    || !hasActiveFunction(functionInventory, functionName)
    || healthResult?.ok !== true
    || healthResult?.data?.persistence !== 'cloudbase-mysql') {
    throw new Error(`${functionName} cloud verification failed`)
  }
  if (!['membership-payment-ledger'].includes(functionName)
    && healthResult?.data?.appAllowlistConfigured !== true) {
    throw new Error(`${functionName} app allowlist verification failed`)
  }
  functions.push(functionName)
}

const notificationPermissions = callCloudbase(root, 'queryPermissions', {
  action: 'getResourcePermission',
  resourceType: 'function',
  resourceId: 'membership-notification-worker',
})
let notificationRules
try {
  notificationRules = JSON.parse(notificationPermissions?.data?.permissions?.[0]?.SecurityRule)
}
catch {
  notificationRules = null
}
if (notificationRules?.['membership-notification-worker']?.invoke !== false) {
  throw new Error('Notification worker client invocation is not disabled')
}
const notificationTriggers = callCloudbase(root, 'callCloudApi', {
  service: 'scf',
  action: 'ListTriggers',
  params: {
    FunctionName: 'membership-notification-worker',
    Namespace: envId,
  },
})
const triggerText = JSON.stringify(notificationTriggers)
if (triggerText.includes('membership-notification-every-5m')) {
  throw new Error('Notification worker timer trigger must stay removed; it keeps Serverless MySQL awake')
}

if (['test', 'live'].includes(paymentMode)) {
  for (const functionName of [paymentFunction, paymentCallbackFunction]) {
    const health = callCloudbase(root, 'manageFunctions', {
      action: 'invokeFunction',
      functionName,
      params: { action: 'health' },
    })
    const healthResult = cloudFunctionResult(health)
    const healthy = functionName === paymentFunction
      ? healthResult?.ok === true
      && healthResult?.data?.configReady === true
      && healthResult?.data?.paymentMode === paymentMode
      : healthResult?.errcode === 0 && healthResult?.provider === 'cloudbase-native-cloudpay'
    if (!hasActiveFunction(functionInventory, functionName) || !healthy) {
      throw new Error(`${functionName} cloud verification failed`)
    }
    functions.push(functionName)
  }
  const permissions = callCloudbase(root, 'queryPermissions', {
    action: 'getResourcePermission',
    resourceType: 'function',
    resourceId: paymentCallbackFunction,
  })
  let rules
  try {
    rules = JSON.parse(permissions?.data?.permissions?.[0]?.SecurityRule)
  }
  catch {
    rules = null
  }
  if (rules?.['membership-payment-ledger']?.invoke !== false || rules?.[paymentCallbackFunction]?.invoke !== false) {
    throw new Error('Payment callback and ledger client invocation rules are not enforced')
  }
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'verify-cloud-result.json'), `${JSON.stringify({
  environmentVerified: true,
  persistence: 'cloudbase-mysql',
  paymentMode,
  functions,
  tableCounts,
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[cloud-verify] MySQL schema, functions, health responses, and invocation evidence verified')
