import { describe, expect, it } from 'vitest'
import {
  assertReadyAssertion,
  parseReadyAssertion,
} from '../scripts/lib/runtime-ready-assertion.mjs'
import { evaluateRouteState } from '../scripts/verify-runtime.mjs'

describe('runtime ready assertions', () => {
  it('executes equality and OR assertions against page data', () => {
    expect(() => assertReadyAssertion(
      { state: 'empty' },
      'state === \'ready\' || state === \'empty\'',
      'branches',
    )).not.toThrow()
    expect(() => assertReadyAssertion(
      { state: 'error' },
      'state === \'ready\' || state === \'empty\'',
      'branches',
    )).toThrow('branches failed readyAssertion')
  })

  it('executes membership assertions against the declared field', () => {
    expect(() => assertReadyAssertion(
      { result: 'pending', state: 'unrelated' },
      'result in checking|success|pending|failed',
      'payment-result',
    )).not.toThrow()
    expect(() => assertReadyAssertion(
      { result: 'refund' },
      'result in checking|success|pending|failed',
      'payment-result',
    )).toThrow('result=refund')
  })

  it('rejects expressions outside the runtime assertion grammar', () => {
    expect(() => parseReadyAssertion('state !== \'error\'', 'unsafe')).toThrow('unsupported readyAssertion syntax')
    expect(() => parseReadyAssertion('data.constructor()', 'unsafe')).toThrow('unsupported readyAssertion syntax')
    expect(() => parseReadyAssertion('', 'unsafe')).toThrow('must be a non-empty string')
  })

  it('requires the executable assertion in addition to an accepted state', () => {
    const route = {
      path: 'packages/member/example/index',
      kind: 'data',
      acceptStates: ['ready'],
      readyAssertion: 'mode === \'active\'',
    }
    expect(evaluateRouteState(route, { state: 'ready', mode: 'active' })).toMatchObject({ status: 'passed' })
    expect(evaluateRouteState(route, { state: 'ready', mode: 'inactive' })).toMatchObject({
      status: 'failed',
      state: 'ready',
    })
  })
})
