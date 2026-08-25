'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMessageScheduler, normalizedWake } = require('../domain/scheduler')
const { createTimerMessage } = require('../lib/auth')
const { createTriggerController } = require('../lib/trigger-controller')

const APP_ID = 'wx0123456789abcdef'
const config = Object.freeze({ allowedAppIds: new Set([APP_ID]) })

describe('message scheduler convergence', () => {
  it('rechecks the plan until the fixed timer readback is stable', async () => {
    const plans = [
      '2030-08-25T10:05:00.000Z',
      '2030-08-25T10:04:00.000Z',
      '2030-08-25T10:04:00.000Z',
      '2030-08-25T10:04:00.000Z',
    ]
    const wakes = []
    const scheduler = createMessageScheduler({
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

  it('runs every allowed app, retries outbox uncertainty by throwing, and handles canary separately', async () => {
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
    const failed = createMessageScheduler({
      config: multiAppConfig,
      trigger,
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue(appId) {
          invokedApps.push(appId)
          return { outboxWakeup: appId === APP_ID ? 'FAILED' : 'INVOKED' }
        },
      },
    })
    await assert.rejects(
      () => failed.handleTimer({ purpose: 'DISPATCH' }),
      /MESSAGE_SCHEDULER_OUTBOX_WAKEUP_FAILED/,
    )
    assert.deepEqual(invokedApps, [APP_ID, otherAppId].sort())

    let runs = 0
    const canary = createMessageScheduler({
      config,
      trigger,
      admin: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue() { runs += 1; return { outboxWakeup: 'INVOKED' } },
      },
    })
    const result = await canary.handleTimer({ purpose: 'CANARY' })
    assert.equal(result.canary, 'RECEIVED')
    assert.equal(runs, 0)
  })

  it('reconciles stale dispatch retries without rerunning due work and rejects invalid plans', async () => {
    let runs = 0
    let closes = 0
    const scheduler = createMessageScheduler({
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
    const scheduler = createMessageScheduler({
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
          if (!active) throw new Error('MESSAGE_SCHEDULER_CANARY_LOCKED')
        },
        async close() { return { state: 'CLOSED' } },
        async setWake() { throw new Error('NOT_EXPECTED') },
      },
    })
    await assert.rejects(() => scheduler.reconcile(), /MESSAGE_SCHEDULER_CANARY_LOCKED/)
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
      functionName: 'mip-message-scheduler',
      triggerName: 'mip-message-campaign-next',
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
    const scheduler = createMessageScheduler({
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
