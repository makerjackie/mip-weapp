'use strict'

const MAX_STABILITY_PASSES = 3
const MAX_SOURCES_PER_TIMER = 3

function createKnowledgeScheduler(options) {
  const { admin, config, trigger } = options
  if (!admin || typeof admin.getWakePlan !== 'function' || typeof admin.runDue !== 'function'
    || !trigger || typeof trigger.setWake !== 'function' || typeof trigger.close !== 'function'
    || typeof trigger.assertReconcileAllowed !== 'function'
    || typeof trigger.activateCanary !== 'function') {
    throw new TypeError('KNOWLEDGE_SCHEDULER_DEPENDENCIES_INVALID')
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
    throw new Error('KNOWLEDGE_SCHEDULER_PLAN_UNSTABLE')
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
      if (closed.state !== 'CLOSED') throw new Error('KNOWLEDGE_SCHEDULER_CANARY_STALE')
      return { verified: true, canary: 'RECEIVED', triggerState: closed.state }
    }
    const runs = []
    let runFailure
    let remaining = MAX_SOURCES_PER_TIMER
    for (const appId of [...config.allowedAppIds].sort()) {
      if (remaining < 1) break
      try {
        const result = await admin.runDue(appId, remaining)
        const redacted = redactedRun(result, remaining)
        runs.push(redacted)
        remaining -= redacted.claimed
      }
      catch (error) {
        runFailure ||= error instanceof Error
          ? error
          : new Error('KNOWLEDGE_SCHEDULER_ADMIN_INVOCATION_FAILED')
        // A lost response may hide completed work, so no capacity can be reassigned safely.
        remaining = 0
        break
      }
    }
    const automation = await reconcile()
    if (runFailure) throw runFailure
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
    throw new Error('KNOWLEDGE_SCHEDULER_WAKE_PLAN_INVALID')
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() >= 2100) {
    throw new Error('KNOWLEDGE_SCHEDULER_WAKE_PLAN_INVALID')
  }
  return value
}

function sameInstant(left, right) {
  return (left || null) === (right || null)
}

function redactedRun(value = {}, maximumClaimed = MAX_SOURCES_PER_TIMER) {
  const claimed = strictCount(value.claimed)
  const completed = strictCount(value.completed)
  const failed = strictCount(value.failed)
  const leaseLost = strictCount(value.leaseLost)
  const reconciled = strictCount(value.reconciled)
  if (claimed > maximumClaimed || completed + failed + leaseLost !== claimed) {
    throw new Error('KNOWLEDGE_SCHEDULER_RUN_RESULT_INVALID')
  }
  return { claimed, completed, failed, leaseLost, reconciled }
}

function strictCount(value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('KNOWLEDGE_SCHEDULER_RUN_RESULT_INVALID')
  }
  return parsed
}

module.exports = {
  MAX_SOURCES_PER_TIMER,
  MAX_STABILITY_PASSES,
  createKnowledgeScheduler,
  normalizedWake,
  readEarliestPlan,
  redactedRun,
}
