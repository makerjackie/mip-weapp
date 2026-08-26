import { describe, expect, it } from 'vitest'
import {
  assertReadyAssertion,
  parseReadyAssertion,
} from '../scripts/lib/runtime-ready-assertion.mjs'
import {
  evaluateRouteState,
  queryForRoute,
  resolveQueryFixtureValues,
} from '../scripts/verify-runtime.mjs'

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

  it('keeps checking pending and rejects failed payment results', () => {
    const route = {
      path: 'packages/member/payment-result/index',
      kind: 'result',
      states: ['checking', 'success', 'pending', 'failed', 'refund'],
      acceptStates: ['success', 'pending', 'refund'],
      pendingStates: ['checking'],
      readyAssertion: 'result in success|pending|refund',
    }
    expect(evaluateRouteState(route, { result: 'checking' })).toMatchObject({ status: 'pending' })
    expect(evaluateRouteState(route, { result: 'failed' })).toMatchObject({ status: 'failed' })
    expect(evaluateRouteState(route, { result: 'refund' })).toMatchObject({ status: 'passed' })
  })

  it('resolves query values from route-specific page data without placeholders', () => {
    const route = {
      path: 'packages/member/mip-public-profile/index',
      query: ['profileRef'],
      queryFixture: {
        sourceRoute: 'packages/member/mip-people/index',
        dataPath: 'people',
        values: { profileRef: 'profileRef' },
      },
    }
    const resolved = resolveQueryFixtureValues(route, {
      people: [{ profileRef: 'p1.real.iv.tag' }],
    })
    expect(resolved).toEqual({
      status: 'resolved',
      values: { profileRef: 'p1.real.iv.tag' },
    })
    expect(queryForRoute(route, resolved.status === 'resolved' ? resolved.values : {}))
      .toBe('profileRef=p1.real.iv.tag')
    expect(resolveQueryFixtureValues(route, { people: [] })).toMatchObject({ status: 'external-wait' })
  })

  it('selects the first matching fixture that also has every required query value', () => {
    const route = {
      path: 'packages/member/mip-game/team/index',
      query: ['teamId'],
      queryFixture: {
        sourceRoute: 'packages/member/mip-game/index',
        dataPath: 'rankings',
        where: { subjectType: 'TEAM' },
        values: { teamId: 'teamId' },
      },
    }
    expect(resolveQueryFixtureValues(route, {
      rankings: [
        { subjectType: 'USER', teamId: 'user-row' },
        { subjectType: 'TEAM', teamId: '' },
        { subjectType: 'TEAM', teamId: 'team-real' },
      ],
    })).toEqual({ status: 'resolved', values: { teamId: 'team-real' } })
  })
})
