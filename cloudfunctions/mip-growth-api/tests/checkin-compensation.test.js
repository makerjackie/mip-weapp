'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCheckInGrowthRepository } = require('../domain/checkin-compensation')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const checkinId = '20000000-0000-4000-8000-000000000001'
const registrationId = '30000000-0000-4000-8000-000000000001'
const eventId = '40000000-0000-4000-8000-000000000001'
const firstRecordedId = '50000000-0000-4000-8000-000000000001'
const firstReversalId = '50000000-0000-4000-8000-000000000002'
const secondRecordedId = '50000000-0000-4000-8000-000000000003'
const actorUserId = '60000000-0000-4000-8000-000000000001'

function recorded(id, checkinVersion, registrationVersion) {
  return {
    id,
    app_id: appId,
    checkin_id: checkinId,
    registration_id: registrationId,
    event_id: eventId,
    user_id: userId,
    transition_type: 'CHECKED_IN',
    checkin_version: checkinVersion,
    registration_version: registrationVersion,
    reversal_of_transition_id: null,
    actor_user_id: userId,
  }
}

function reversal(id, originalId, checkinVersion, registrationVersion) {
  return {
    ...recorded(id, checkinVersion, registrationVersion),
    transition_type: 'REVOKED',
    reversal_of_transition_id: originalId,
    actor_user_id: actorUserId,
  }
}

function fixture() {
  const transitions = new Map([[firstRecordedId, recorded(firstRecordedId, 1, 3)]])
  const entries = []
  const calls = []
  const account = {
    user_id: userId,
    experience_balance: 0,
    contribution_balance: 0,
    coin_balance: 0,
    version: 1,
  }
  const rule = {
    id: '70000000-0000-4000-8000-000000000001',
    rule_key: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    delta_value: 100,
    daily_limit_value: 100,
    source_event_type: 'event.checked_in',
    status: 'ACTIVE',
  }
  let idCounter = 0
  const createId = () => `8${String(++idCounter).padStart(7, '0')}-0000-4000-8000-000000000001`

  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('SELECT id, transition_type, reversal_of_transition_id')) {
        return transitions.get(params[1]) || null
      }
      if (sql.includes('FROM mip_event_checkin_transitions transition')) {
        const item = transitions.get(params[1])
        return item?.transition_type === 'CHECKED_IN' ? item : null
      }
      if (sql.includes('FROM mip_event_checkins checkin')) return { id: checkinId }
      if (sql.includes('reversal_of_transition_id = ?')) {
        return [...transitions.values()].find(item => (
          item.transition_type === 'REVOKED' && item.reversal_of_transition_id === params[1]
        )) || null
      }
      if (sql.includes('FROM mip_growth_accounts')) return account
      if (sql.includes('COALESCE(SUM(GREATEST(entry.delta_value, 0))')) {
        const reversed = new Set([...transitions.values()]
          .filter(item => item.transition_type === 'REVOKED')
          .map(item => item.reversal_of_transition_id))
        const total = entries
          .filter(item => item.rule_id === params[2]
            && item.delta_value > 0
            && !(item.source_event_type === 'event.checked_in' && reversed.has(item.source_event_id)))
          .reduce((sum, item) => sum + item.delta_value, 0)
        return { total }
      }
      if (sql.includes('FROM mip_growth_entries')) {
        const sourceType = sql.includes("source_event_type = 'event.checkin_revoked'")
          ? 'event.checkin_revoked'
          : 'event.checked_in'
        return entries.find(item => item.source_event_type === sourceType
          && item.source_event_id === params[2]
          && item.metric === params[3]) || null
      }
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('FROM mip_growth_rules')) return [rule]
      if (sql.includes('FROM mip_growth_entries') && sql.includes('ORDER BY id FOR UPDATE')) {
        return entries.filter(item => item.source_event_type === 'event.checked_in'
          && item.source_event_id === params[2])
      }
      if (sql.includes('UPDATE mip_growth_accounts SET')) {
        const field = sql.match(/SET ([a-z_]+) = \?/)?.[1]
        account[field] = params[0]
        account.version += 1
        return { affectedRows: 1 }
      }
      if (sql.includes('INSERT INTO mip_growth_entries')) {
        entries.push({
          id: params[0],
          app_id: params[1],
          user_id: params[2],
          rule_id: params[3],
          source_event_id: params[4],
          source_event_type: params[5],
          metric: params[6],
          delta_value: params[7],
          balance_after: params[8],
          adjustment_reason: params[9],
          actor_user_id: params[10],
        })
        return { affectedRows: 1 }
      }
      if (sql.includes('INSERT INTO mip_growth_accounts') || sql.includes('INSERT INTO mip_outbox_events')) {
        return { affectedRows: 1 }
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  return {
    account,
    calls,
    entries,
    repository: createCheckInGrowthRepository({ transaction: work => work(tx) }, { createId }),
    transitions,
  }
}

describe('check-in growth compensation', () => {
  it('reverses the exact applied delta once after an awarded check-in', async () => {
    const state = fixture()
    const awarded = await state.repository.applyCheckInTransition({ appId, transitionId: firstRecordedId })
    assert.equal(awarded.status, 'APPLIED')
    assert.equal(state.account.experience_balance, 100)

    state.transitions.set(firstReversalId, reversal(firstReversalId, firstRecordedId, 2, 4))
    const reversed = await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    assert.equal(reversed.status, 'REVERSED')
    assert.equal(state.account.experience_balance, 0)
    assert.deepEqual(state.entries.map(item => item.delta_value), [100, -100])
    assert.equal(state.entries[1].adjustment_reason, `签到撤销冲销:${state.entries[0].id}`)
    assert.equal(state.entries[1].actor_user_id, actorUserId)

    await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    assert.equal(state.entries.length, 2)
    assert.equal(state.account.experience_balance, 0)
  })

  it('does not award when revocation is committed before either outbox projection', async () => {
    const state = fixture()
    state.transitions.set(firstReversalId, reversal(firstReversalId, firstRecordedId, 2, 4))
    const staleAward = await state.repository.applyCheckInTransition({ appId, transitionId: firstRecordedId })
    const reversalResult = await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    assert.equal(staleAward.status, 'REVERSED_BEFORE_PROJECTION')
    assert.equal(reversalResult.status, 'NO_AWARD_TO_REVERSE')
    assert.equal(state.entries.length, 0)
    assert.equal(state.account.experience_balance, 0)
  })

  it('keeps the exact reversal delta when later entries already reduced the balance', async () => {
    const state = fixture()
    await state.repository.applyCheckInTransition({ appId, transitionId: firstRecordedId })
    state.account.experience_balance = 20
    state.transitions.set(firstReversalId, reversal(firstReversalId, firstRecordedId, 2, 4))
    await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    assert.equal(state.entries[1].delta_value, -100)
    assert.equal(state.entries[1].balance_after, -80)
    assert.equal(state.account.experience_balance, -80)
  })

  it('restores the daily allowance when the participant checks in again after revocation', async () => {
    const state = fixture()
    await state.repository.applyCheckInTransition({ appId, transitionId: firstRecordedId })
    state.transitions.set(firstReversalId, reversal(firstReversalId, firstRecordedId, 2, 4))
    await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    state.transitions.set(secondRecordedId, recorded(secondRecordedId, 3, 5))

    const secondAward = await state.repository.applyCheckInTransition({ appId, transitionId: secondRecordedId })
    assert.equal(secondAward.status, 'APPLIED')
    assert.deepEqual(state.entries.map(item => item.delta_value), [100, -100, 100])
    assert.equal(state.account.experience_balance, 100)
  })

  it('locks the recorded transition before its reversal and account', async () => {
    const state = fixture()
    state.transitions.set(firstReversalId, reversal(firstReversalId, firstRecordedId, 2, 4))
    await state.repository.applyCheckInTransition({ appId, transitionId: firstReversalId })
    const locks = state.calls.filter(call => /FOR UPDATE/.test(call.sql))
    assert.match(locks[0].sql, /transition\.transition_type = 'CHECKED_IN'/)
    assert.match(locks[1].sql, /reversal_of_transition_id = \?/)
    assert.match(locks[2].sql, /mip_growth_accounts/)
  })
})
