'use strict'

const MAX_STABILITY_PASSES = 3

function createMessageScheduler(options) {
  const { admin, config, trigger } = options
  if (!admin || typeof admin.getWakePlan !== 'function' || typeof admin.runDue !== 'function'
    || !trigger || typeof trigger.setWake !== 'function' || typeof trigger.close !== 'function'
    || typeof trigger.assertReconcileAllowed !== 'function'
    || typeof trigger.activateCanary !== 'function') {
    throw new TypeError('MESSAGE_SCHEDULER_DEPENDENCIES_INVALID')
  }

  async function reconcile() {
    for (let pass = 1; pass <= MAX_STABILITY_PASSES; pass += 1) {
      await trigger.assertReconcileAllowed()
      const before = await readEarliestPlan(admin, config.allowedAppIds)
      const applied = before
        ? await trigger.setWake(before, 'DISPATCH')
        : await trigger.close()
      const after = await readEarliestPlan(admin, config.allowedAppIds)
      if (sameInstant(before, after)) {
        return { verified: true, pass, nextWakeAt: after, triggerState: applied.state }
      }
    }
    throw new Error('MESSAGE_SCHEDULER_PLAN_UNSTABLE')
  }

  async function activateCanary(generation) {
    const activation = await trigger.activateCanary(generation)
    const result = await reconcile()
    return { ...result, activation }
  }

  async function handleTimer(message) {
    const current = await trigger.matches(message)
    if (!current) {
      if (message.purpose === 'DISPATCH') {
        return { ...await reconcile(), ignored: 'STALE_TIMER' }
      }
      return { verified: true, ignored: 'STALE_TIMER' }
    }
    if (message.purpose === 'CANARY') {
      const closed = await trigger.close(message)
      if (closed.state !== 'CLOSED') throw new Error('MESSAGE_SCHEDULER_CANARY_STALE')
      return { verified: true, canary: 'RECEIVED', triggerState: closed.state }
    }
    const runs = []
    let runFailure
    const outcomes = await Promise.all([...config.allowedAppIds].sort().map(async (appId) => {
      try {
        return { result: await admin.runDue(appId) }
      }
      catch (error) {
        return { error }
      }
    }))
    for (const outcome of outcomes) {
      if (outcome.result) {
        const result = outcome.result
        const run = redactedRun(result)
        runs.push(run)
        if (run.outboxWakeup !== 'INVOKED') {
          runFailure ||= new Error('MESSAGE_SCHEDULER_OUTBOX_WAKEUP_FAILED')
        }
      }
      else {
        runFailure ||= outcome.error instanceof Error
          ? outcome.error
          : new Error('MESSAGE_SCHEDULER_ADMIN_INVOCATION_FAILED')
      }
    }
    if (runFailure) throw runFailure
    const automation = await reconcile()
    return { ...automation, runs }
  }

  return { activateCanary, handleTimer, reconcile }
}

async function readEarliestPlan(admin, appIds) {
  const plans = await Promise.all([...appIds].sort().map(async (appId) => {
    const plan = await admin.getWakePlan(appId)
    return normalizedWake(plan?.nextWakeAt)
  }))
  return plans.filter(Boolean).sort()[0] || null
}

function normalizedWake(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) {
    throw new Error('MESSAGE_SCHEDULER_WAKE_PLAN_INVALID')
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() >= 2100) {
    throw new Error('MESSAGE_SCHEDULER_WAKE_PLAN_INVALID')
  }
  return value
}

function sameInstant(left, right) {
  return (left || null) === (right || null)
}

function redactedRun(value = {}) {
  return {
    batches: count(value.batches),
    leased: count(value.leased),
    completed: count(value.completed),
    reconciled: count(value.reconciled),
    terminal: count(value.terminal),
    manualReview: count(value.manualReview),
    pendingReconciliation: count(value.pendingReconciliation),
    outboxWakeup: ['INVOKED', 'SKIPPED', 'FAILED'].includes(value.outboxWakeup)
      ? value.outboxWakeup
      : 'FAILED',
  }
}

function count(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

module.exports = {
  MAX_STABILITY_PASSES,
  createMessageScheduler,
  normalizedWake,
  readEarliestPlan,
}
