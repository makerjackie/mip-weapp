'use strict'

const {
  ACTIVATE_ACTION,
  RECONCILE_ACTION,
  parseTimerEvent,
  verifySchedulerActivation,
  verifySchedulerReconcile,
} = require('./lib/auth')
const { createAdminClient } = require('./lib/admin-client')
const { runtimeCredentials, schedulerConfig } = require('./lib/config')
const { createScfClient } = require('./lib/scf')
const { createTriggerController } = require('./lib/trigger-controller')
const { createMessageScheduler } = require('./domain/scheduler')

function createRuntime(context) {
  const config = schedulerConfig()
  const scf = createScfClient({
    credentials: runtimeCredentials(context),
    region: config.region,
  })
  const admin = createAdminClient({ config, scf })
  const trigger = createTriggerController({ config, scf })
  return { config, scheduler: createMessageScheduler({ admin, config, trigger }) }
}

exports.main = async (event = {}, context = {}) => {
  const runtime = createRuntime(context)
  if (event?.action === 'health') {
    return {
      ok: true,
      data: {
        service: runtime.config.functionName,
        persistence: 'none',
        triggerMode: 'single-rolling-one-shot',
      },
    }
  }
  if (event?.action === RECONCILE_ACTION) {
    try {
      verifySchedulerReconcile(event, runtime.config)
      return { ok: true, data: await runtime.scheduler.reconcile() }
    }
    catch (error) {
      safeWarn(error, 'reconcile')
      return {
        ok: false,
        error: {
          code: error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'MESSAGE_SCHEDULER_UNAVAILABLE',
          message: error?.message === 'FORBIDDEN' ? '内部调度请求未授权' : '自动定时服务暂时不可用',
          retryable: error?.message !== 'FORBIDDEN',
        },
      }
    }
  }
  if (event?.action === ACTIVATE_ACTION) {
    try {
      const trusted = verifySchedulerActivation(event, runtime.config)
      return { ok: true, data: await runtime.scheduler.activateCanary(trusted.generation) }
    }
    catch (error) {
      safeWarn(error, 'activate')
      return {
        ok: false,
        error: {
          code: error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'MESSAGE_SCHEDULER_ACTIVATION_UNVERIFIED',
          message: error?.message === 'FORBIDDEN' ? '内部调度请求未授权' : '定时服务激活状态尚未确认',
          retryable: error?.message !== 'FORBIDDEN',
        },
      }
    }
  }

  // SCF timer delivery is asynchronous; throwing preserves the platform retry contract.
  const timer = parseTimerEvent(event, runtime.config)
  return { ok: true, data: await runtime.scheduler.handleTimer(timer.message) }
}

function safeWarn(error, mode) {
  try {
    console.warn('[mip-message-scheduler]', {
      event: 'scheduler_invocation_failed',
      mode,
      code: publicErrorCode(error?.message),
    })
  }
  catch {}
}

function publicErrorCode(value) {
  const code = typeof value === 'string' ? value.trim() : ''
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'MESSAGE_SCHEDULER_FAILED'
}

exports._test = { createRuntime, publicErrorCode }
