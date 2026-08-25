'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { MAX_REARM_ATTEMPTS, createTriggerController, oneShotCron } = require('../lib/trigger-controller')

const SECRET = 'scheduler-trigger-test-secret-at-least-32-bytes'
const config = Object.freeze({
  namespace: 'mip-test-env',
  functionName: 'mip-message-scheduler',
  triggerName: 'mip-message-campaign-next',
  cronUtcOffsetMinutes: 480,
  secret: SECRET,
})

describe('single rolling message trigger', () => {
  it('rounds up, writes one seven-field cron, reads it back, and closes without a sentinel', async () => {
    const calls = []
    const state = {
      TriggerName: config.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
      TriggerDesc: '0 0 0 1 1 ? 2030',
      Enable: 0,
      CustomArgument: validArgument(),
    }
    const scf = {
      async ListTriggers() { return { TotalCount: 1, Triggers: [{ ...state }] } },
      async UpdateTrigger(input) {
        calls.push(input)
        state.TriggerDesc = input.TriggerDesc
        state.Enable = input.Enable === 'OPEN' ? 1 : 0
        state.CustomArgument = input.CustomArgument
        return { RequestId: 'request' }
      },
    }
    const controller = createTriggerController({
      config,
      scf,
      now: () => Date.parse('2030-08-25T10:00:00.500Z'),
      generation: () => 'abcdefabcdefabcdefabcdefabcdefab',
    })
    const open = await controller.setWake('2030-08-25T10:00:01.001Z')
    assert.deepEqual(open, {
      state: 'OPEN',
      fireAt: '2030-08-25T10:01:01.000Z',
      generation: 'abcdefabcdefabcdefabcdefabcdefab',
      purpose: 'DISPATCH',
      rearmAttempts: 1,
    })
    assert.equal(calls[0].TriggerDesc, '1 1 18 25 8 ? 2030')
    assert.equal(calls[0].Type, 'timer')
    assert.equal(calls[0].TriggerName, config.triggerName)
    const armedMessage = JSON.parse(state.CustomArgument)
    assert.equal(await controller.matches({
      ...armedMessage,
      activationGeneration: '00000000000000000000000000000000',
    }), false)
    const closed = await controller.close()
    assert.equal(closed.state, 'CLOSED')
    assert.equal(calls[1].Enable, 'CLOSE')
    assert.equal(calls[1].TriggerDesc, calls[0].TriggerDesc)
    assert.equal(JSON.parse(calls[1].CustomArgument).fireAt, '2030-08-25T10:01:01.000Z')
    assert.equal('Argument' in calls[0], false)
    assert.equal(calls.some(call => call.TriggerDesc.includes('2099')), false)
  })

  it('uses the explicitly canaried cron offset and rejects 2100', () => {
    assert.equal(oneShotCron('2030-01-02T03:04:05.000Z', 0), '5 4 3 2 1 ? 2030')
    assert.equal(oneShotCron('2030-01-02T03:04:05.000Z', 480), '5 4 11 2 1 ? 2030')
    assert.throws(() => oneShotCron('2100-01-01T00:00:00.000Z', 0), /SCHEDULER_WAKE_TIME_INVALID/)
    assert.throws(() => oneShotCron('2099-12-31T20:00:00.000Z', 480), /SCHEDULER_WAKE_TIME_INVALID/)
  })

  it('fails closed when any second trigger exists', async () => {
    const controller = createTriggerController({
      config,
      scf: {
        async ListTriggers() {
          return { TotalCount: 2, Triggers: [
            { TriggerName: config.triggerName, Type: 'timer', Qualifier: '$DEFAULT' },
            { TriggerName: config.triggerName, Type: 'timer', Qualifier: 'published' },
          ] }
        },
        async UpdateTrigger() {},
      },
    })
    await assert.rejects(() => controller.read(), /SCHEDULER_TRIGGER_INVENTORY_INVALID/)
  })

  it('fails closed when ListTriggers is partial', async () => {
    const controller = createTriggerController({
      config,
      scf: {
        async ListTriggers() {
          return { TotalCount: 2, Triggers: [
            { TriggerName: config.triggerName, Type: 'timer', Qualifier: '$DEFAULT' },
          ] }
        },
        async UpdateTrigger() {},
      },
    })
    await assert.rejects(() => controller.read(), /SCHEDULER_TRIGGER_READ_FAILED/)
  })

  it('keeps open and closed canaries locked until matching activation', async () => {
    const calls = []
    const canary = JSON.parse(validArgument('CANARY'))
    const state = {
      TriggerName: config.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
      TriggerDesc: '0 0 8 1 1 ? 2030',
      Enable: 1,
      CustomArgument: JSON.stringify(canary),
    }
    const controller = createTriggerController({
      config,
      now: () => Date.parse('2030-01-01T00:01:00.000Z'),
      generation: () => 'abcdefabcdefabcdefabcdefabcdefab',
      scf: {
        async ListTriggers() { return { TotalCount: 1, Triggers: [{ ...state }] } },
        async UpdateTrigger(input) {
          calls.push(input)
          state.Enable = input.Enable === 'OPEN' ? 1 : 0
          state.CustomArgument = input.CustomArgument
        },
      },
    })
    await assert.rejects(() => controller.setWake('2030-01-01T00:02:00.000Z'), /CANARY_LOCKED/)
    await assert.rejects(() => controller.close(), /CANARY_LOCKED/)
    assert.equal(calls.length, 0)
    state.Enable = 0
    await assert.rejects(() => controller.setWake('2030-01-01T00:02:00.000Z'), /CANARY_LOCKED/)
    await assert.rejects(
      () => controller.activateCanary('abcdefabcdefabcdefabcdefabcdefab'),
      /CANARY_NOT_VERIFIED/,
    )
    const activated = await controller.activateCanary(canary.generation)
    assert.equal(activated.state, 'ACTIVE')
    assert.equal(JSON.parse(state.CustomArgument).purpose, 'DISPATCH')
    assert.equal(JSON.parse(state.CustomArgument).activationGeneration, canary.generation)
    assert.equal(state.Enable, 0)
    const resumed = await controller.activateCanary(canary.generation)
    assert.equal(resumed.resumed, true)
  })

  it('re-arms a due wake when the first control-plane readback consumes the safety margin', async () => {
    let clock = Date.parse('2030-08-25T10:00:00.000Z')
    let updates = 0
    let delayed = false
    const state = {
      TriggerName: config.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
      TriggerDesc: '0 0 0 1 1 ? 2030',
      Enable: 0,
      CustomArgument: validArgument(),
    }
    const controller = createTriggerController({
      config,
      now: () => clock,
      generation: () => String(updates + 1).padStart(32, '0'),
      scf: {
        async ListTriggers() {
          if (updates === 1 && !delayed) {
            clock += 35_000
            delayed = true
          }
          return { TotalCount: 1, Triggers: [{ ...state }] }
        },
        async UpdateTrigger(input) {
          updates += 1
          state.TriggerDesc = input.TriggerDesc
          state.Enable = 1
          state.CustomArgument = input.CustomArgument
        },
      },
    })
    const result = await controller.setWake('2030-08-25T10:00:00.000Z')
    assert.equal(result.rearmAttempts, 2)
    assert.equal(result.fireAt, '2030-08-25T10:01:35.000Z')
    assert.equal(updates, 2)
  })

  it('fails after bounded re-arms when every control-plane readback consumes the margin', async () => {
    let clock = Date.parse('2030-08-25T10:00:00.000Z')
    let updates = 0
    let awaitingReadback = false
    const state = {
      TriggerName: config.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
      TriggerDesc: '0 0 0 1 1 ? 2030',
      Enable: 0,
      CustomArgument: validArgument(),
    }
    const controller = createTriggerController({
      config,
      now: () => clock,
      generation: () => String(updates + 1).padStart(32, '0'),
      scf: {
        async ListTriggers() {
          if (awaitingReadback) {
            clock += 61_000
            awaitingReadback = false
          }
          return { TotalCount: 1, Triggers: [{ ...state }] }
        },
        async UpdateTrigger(input) {
          updates += 1
          awaitingReadback = true
          state.TriggerDesc = input.TriggerDesc
          state.Enable = 1
          state.CustomArgument = input.CustomArgument
        },
      },
    })
    await assert.rejects(
      () => controller.setWake('2030-08-25T10:00:00.000Z'),
      /SCHEDULER_TRIGGER_PROPAGATION_UNVERIFIED/,
    )
    assert.equal(updates, MAX_REARM_ATTEMPTS)
  })
})

function validArgument(purpose = 'DISPATCH') {
  const { createTimerMessage } = require('../lib/auth')
  return JSON.stringify(createTimerMessage({
    namespace: config.namespace,
    functionName: config.functionName,
    triggerName: config.triggerName,
    fireAt: '2030-01-01T00:00:00.000Z',
    generation: '1234567890abcdef1234567890abcdef',
    activationGeneration: purpose === 'CANARY'
      ? '1234567890abcdef1234567890abcdef'
      : 'abcdefabcdefabcdefabcdefabcdefab',
    purpose,
  }, SECRET))
}
