'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createKnowledgeScheduler, normalizedWake } = require('../domain/scheduler')
const { createTimerMessage } = require('../lib/auth')
const { createTriggerController } = require('../lib/trigger-controller')

const APP_ID = 'wx0123456789abcdef'
const config = Object.freeze({ allowedAppIds: new Set([APP_ID]) })

describe('knowledge scheduler convergence', () => {
  it('rechecks the plan until the fixed timer readback is stable', async () => {
    const plans = [
      '2030-08-25T10:05:00.000Z',
      '2030-08-25T10:04:00.000Z',
      '2030-08-25T10:04:00.000Z',
      '2030-08-25T10:04:00.000Z',
    ]
    const wakes = []
    const scheduler = createKnowledgeScheduler({
      config,
      admin: {
        async getWakePlan() { return { nextWakeAt: plans.shift() } },
        async runDue() { throw new Error('NOT_EXPECTED') },
      },
      trigger: {
        async activateCanary() { throw new Error('NOT_EXPECTED') },
        async assertReconcileAllowed() {},
        async setWake(value) { wakes.push(value); return { state: 'OPEN' } },
        async close() { return { state: 'CLOSED' } },
      },
    })
    const result = await scheduler.reconcile()
    assert.equal(result.verified, true)
    assert.equal(result.pass, 2)
    assert.deepEqual(wakes, [
      '2030-08-25T10:05:00.000Z',
      '2030-08-25T10:04:00.000Z',
    ])
  })

  it('runs every allowed app, returns only bounded counters, and handles canary separately', async () => {
    const otherAppId = 'wxabcdef0123456789'
    const multiAppConfig = Object.freeze({ allowedAppIds: new Set([APP_ID, otherAppId]) })
    const trigger = {
      async activateCanary() { throw new Error('NOT_EXPECTED') },
      async assertReconcileAllowed() {},
      async matches() { return true },
      async setWake() { return { state: 'OPEN' } },
      async close() { return { state: 'CLOSED' } },
    }
    const invokedApps = []
    const scheduler = createKnowledgeScheduler({
      config: multiAppConfig,
      trigger,
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue(appId, limit) {
          invokedApps.push({ appId, limit })
          return {
            claimed: appId === APP_ID ? 2 : 1,
            completed: 1,
            failed: appId === APP_ID ? 1 : 0,
            leaseLost: 0,
            reconciled: 0,
            outcomes: [{ private: 'not returned by scheduler' }],
          }
        },
      },
    })
    const dispatch = await scheduler.handleTimer({ purpose: 'DISPATCH' })
    const sortedApps = [APP_ID, otherAppId].sort()
    assert.deepEqual(invokedApps, [
      { appId: sortedApps[0], limit: 3 },
      { appId: sortedApps[1], limit: 1 },
    ])
    assert.deepEqual(dispatch.runs, [
      { claimed: 2, completed: 1, failed: 1, leaseLost: 0, reconciled: 0 },
      { claimed: 1, completed: 1, failed: 0, leaseLost: 0, reconciled: 0 },
    ])

    let runs = 0
    const canary = createKnowledgeScheduler({
      config,
      trigger,
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue() { runs += 1; return { claimed: 0 } },
      },
    })
    const result = await canary.handleTimer({ purpose: 'CANARY' })
    assert.equal(result.canary, 'RECEIVED')
    assert.equal(runs, 0)
  })

  it('does not reassign capacity after an uncertain or inconsistent admin result', async () => {
    const otherAppId = 'wxabcdef0123456789'
    const invokedApps = []
    const scheduler = createKnowledgeScheduler({
      config: Object.freeze({ allowedAppIds: new Set([APP_ID, otherAppId]) }),
      trigger: {
        async activateCanary() { throw new Error('NOT_EXPECTED') },
        async assertReconcileAllowed() {},
        async matches() { return true },
        async setWake() { throw new Error('NOT_EXPECTED') },
        async close() { return { state: 'CLOSED' } },
      },
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue(appId) {
          invokedApps.push(appId)
          throw new Error('ADMIN_RESPONSE_LOST')
        },
      },
    })
    await assert.rejects(() => scheduler.handleTimer({ purpose: 'DISPATCH' }), /ADMIN_RESPONSE_LOST/)
    assert.deepEqual(invokedApps, [[APP_ID, otherAppId].sort()[0]])

    const inconsistent = createKnowledgeScheduler({
      config: Object.freeze({ allowedAppIds: new Set([APP_ID, otherAppId]) }),
      trigger: {
        async activateCanary() { throw new Error('NOT_EXPECTED') },
        async assertReconcileAllowed() {},
        async matches() { return true },
        async setWake() { throw new Error('NOT_EXPECTED') },
        async close() { return { state: 'CLOSED' } },
      },
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue() {
          return { claimed: 1, completed: 1, failed: 1, leaseLost: 0, reconciled: 0 }
        },
      },
    })
    await assert.rejects(
      () => inconsistent.handleTimer({ purpose: 'DISPATCH' }),
      /RUN_RESULT_INVALID/,
    )
  })

  it('reconciles stale dispatch retries without rerunning due work and rejects invalid plans', async () => {
    let runs = 0
    let closes = 0
    const scheduler = createKnowledgeScheduler({
      config,
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue() { runs += 1; throw new Error('NOT_EXPECTED') },
      },
      trigger: {
        async activateCanary() { throw new Error('NOT_EXPECTED') },
        async assertReconcileAllowed() {},
        async matches() { return false },
        async setWake() { throw new Error('NOT_EXPECTED') },
        async close() { closes += 1; return { state: 'CLOSED' } },
      },
    })
    assert.deepEqual(await scheduler.handleTimer({ purpose: 'DISPATCH' }), {
      verified: true,
      pass: 1,
      nextWakeAt: null,
      triggerState: 'CLOSED',
      ignored: 'STALE_TIMER',
    })
    assert.equal(runs, 0)
    assert.equal(closes, 1)
    assert.throws(() => normalizedWake('2100-01-01T00:00:00.000Z'), /WAKE_PLAN_INVALID/)
    assert.throws(() => normalizedWake('2030-01-01'), /WAKE_PLAN_INVALID/)
  })

  it('locks reconciliation through the complete canary state and activates only a matching proof', async () => {
    let active = false
    let planReads = 0
    const scheduler = createKnowledgeScheduler({
      config,
      admin: {
        async getWakePlan() { planReads += 1; return { nextWakeAt: null } },
        async runDue() { throw new Error('NOT_EXPECTED') },
      },
      trigger: {
        async activateCanary(generation) {
          assert.equal(generation, '1234567890abcdef1234567890abcdef')
          active = true
          return { state: 'ACTIVE' }
        },
        async assertReconcileAllowed() {
          if (!active) throw new Error('KNOWLEDGE_SCHEDULER_CANARY_LOCKED')
        },
        async close() { return { state: 'CLOSED' } },
        async setWake() { throw new Error('NOT_EXPECTED') },
      },
    })
    await assert.rejects(() => scheduler.reconcile(), /KNOWLEDGE_SCHEDULER_CANARY_LOCKED/)
    assert.equal(planReads, 0)
    const result = await scheduler.activateCanary('1234567890abcdef1234567890abcdef')
    assert.equal(result.activation.state, 'ACTIVE')
    assert.equal(result.verified, true)
    assert.equal(planReads, 2)
  })

  it('continues the same activation after conversion succeeds but reconciliation fails', async () => {
    const generation = '1234567890abcdef1234567890abcdef'
    const secret = 'scheduler-activation-retry-secret-32-bytes'
    const runtimeConfig = Object.freeze({
      ...config,
      namespace: 'mip-test-env',
      functionName: 'mip-knowledge-scheduler',
      triggerName: 'mip-knowledge-ingestion-next',
      cronUtcOffsetMinutes: 480,
      secret,
    })
    const state = {
      TriggerName: runtimeConfig.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
      TriggerDesc: '0 0 8 1 1 ? 2030',
      Enable: 0,
      CustomArgument: JSON.stringify(createTimerMessage({
        namespace: runtimeConfig.namespace,
        functionName: runtimeConfig.functionName,
        triggerName: runtimeConfig.triggerName,
        fireAt: '2030-01-01T00:00:00.000Z',
        generation,
        activationGeneration: generation,
        purpose: 'CANARY',
      }, secret)),
    }
    const trigger = createTriggerController({
      config: runtimeConfig,
      now: () => Date.parse('2030-01-01T00:01:00.000Z'),
      generation: () => 'abcdefabcdefabcdefabcdefabcdefab',
      scf: {
        async ListTriggers() { return { TotalCount: 1, Triggers: [{ ...state }] } },
        async UpdateTrigger(input) {
          state.Enable = input.Enable === 'OPEN' ? 1 : 0
          state.TriggerDesc = input.TriggerDesc
          state.CustomArgument = input.CustomArgument
        },
      },
    })
    let planReads = 0
    const scheduler = createKnowledgeScheduler({
      config: runtimeConfig,
      trigger,
      admin: {
        async getWakePlan() {
          planReads += 1
          if (planReads === 1) throw new Error('TRANSIENT_ADMIN_FAILURE')
          return { nextWakeAt: null }
        },
        async runDue() { throw new Error('NOT_EXPECTED') },
      },
    })

    await assert.rejects(() => scheduler.activateCanary(generation), /TRANSIENT_ADMIN_FAILURE/)
    const partial = JSON.parse(state.CustomArgument)
    assert.equal(partial.purpose, 'DISPATCH')
    assert.equal(partial.activationGeneration, generation)

    const recovered = await scheduler.activateCanary(generation)
    assert.equal(recovered.verified, true)
    assert.equal(recovered.activation.resumed, true)
    assert.equal(JSON.parse(state.CustomArgument).activationGeneration, generation)
  })
})
