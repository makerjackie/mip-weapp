import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { signSchedulerReconcile } = require('../../cloudfunctions/mip-admin-api/lib/message-scheduler-client')

export async function reconcileMessageScheduler(options) {
  const appId = text(options.appId)
  const functionName = text(options.functionName)
  const secret = typeof options.secret === 'string' ? options.secret : ''
  if (!/^wx[0-9a-f]{16}$/i.test(appId)
    || !/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(functionName)
    || secret.length < 32
    || typeof options.invoke !== 'function') {
    throw new Error('Message scheduler recovery configuration is invalid')
  }
  const request = {
    action: 'reconcileMessageCampaignSchedule',
    protocol: 'mip-message-scheduler/reconcile/v1',
    appId,
    sourceFunction: 'mip-admin-api',
    nonce: typeof options.nonce === 'function'
      ? options.nonce()
      : randomBytes(12).toString('hex'),
    timestamp: Number(typeof options.now === 'function' ? options.now() : Date.now()),
  }
  if (!/^[a-f0-9]{24}$/i.test(request.nonce) || !Number.isSafeInteger(request.timestamp)) {
    throw new Error('Message scheduler recovery request is invalid')
  }
  request.signature = signSchedulerReconcile(request, secret)
  const result = await options.invoke({ functionName, request })
  if (result?.ok !== true || result?.data?.verified !== true) {
    throw new Error(publicErrorCode(result?.error?.code))
  }
  return {
    status: 'VERIFIED',
    nextWakeConfigured: Boolean(result.data.nextWakeAt),
  }
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'MESSAGE_SCHEDULER_RECOVERY_UNVERIFIED'
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
