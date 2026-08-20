'use strict'

const { randomUUID } = require('node:crypto')
const cloud = require('wx-server-sdk')
const { parseTemplateConfig } = require('./domain/templates')
const { runNotificationWorker } = require('./domain/worker')
const { mysqlDatabase } = require('./lib/mysql')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const allowedAppIds = String(process.env.MEMBERSHIP_ALLOWED_APP_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const templates = parseTemplateConfig()
const miniprogramState = ['formal', 'trial', 'developer'].includes(
  process.env.MEMBERSHIP_MINIPROGRAM_STATE,
)
  ? process.env.MEMBERSHIP_MINIPROGRAM_STATE
  : 'trial'

function success(data) {
  return { ok: true, data }
}

function failure(error) {
  console.error('[membership-notification-worker]', error)
  return {
    ok: false,
    error: {
      code: error instanceof Error ? error.message : 'INTERNAL_ERROR',
      message: '通知任务执行失败',
    },
  }
}

async function health() {
  const db = mysqlDatabase()
  await db.one('SELECT 1 AS ok')
  for (const table of [
    'member_notifications',
    'member_notification_subscriptions',
    'member_notification_outbox',
  ]) {
    await db.one(`SELECT COUNT(*) AS c FROM ${table} WHERE 1 = 0`)
  }
  return {
    service: 'membership-notification-worker',
    status: 'ok',
    persistence: 'cloudbase-mysql',
    appAllowlistConfigured: allowedAppIds.length > 0,
    configuredTemplates: Object.keys(templates),
    miniprogramState,
    contractVersion: 1,
  }
}

async function run() {
  if (!allowedAppIds.length) {
    throw new Error('APP_ALLOWLIST_REQUIRED')
  }
  return runNotificationWorker(mysqlDatabase(), {
    appIds: allowedAppIds,
    templates,
    miniprogramState,
    limit: 100,
    leaseOwner: `timer:${randomUUID()}`,
    send: payload => cloud.openapi.subscribeMessage.send(payload),
  })
}

exports.main = async (event = {}) => {
  try {
    if (event.action === 'health') {
      return success(await health())
    }
    const timerInvocation = event.Type === 'Timer'
      || event.type === 'Timer'
      || event.TriggerName === 'membership-notification-every-5m'
    if (!timerInvocation) {
      throw new Error('FORBIDDEN')
    }
    return success(await run())
  }
  catch (error) {
    return failure(error)
  }
}

module.exports._test = { health, run }
