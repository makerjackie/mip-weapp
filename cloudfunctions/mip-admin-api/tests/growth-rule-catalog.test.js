'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  FIXED_GROWTH_RULES,
  assertFixedGrowthRuleUpdate,
} = require('../domain/growth-rule-catalog')

function rule(overrides = {}) {
  return {
    ruleKey: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    sourceEventType: 'event.checked_in',
    ...overrides,
  }
}

describe('fixed growth rule catalog', () => {
  it('contains only the server-supported reward events', () => {
    assert.deepEqual(Object.keys(FIXED_GROWTH_RULES).sort(), [
      'case_published',
      'event_attended',
      'profile_completed',
      'referral_confirmed',
    ])
  })

  it('accepts value-only edits to a fixed rule', () => {
    assert.deepEqual(
      assertFixedGrowthRuleUpdate(rule(), rule({ deltaValue: 120, dailyLimitValue: 360 })),
      FIXED_GROWTH_RULES.event_attended,
    )
  })

  for (const [label, change] of [
    ['key', { ruleKey: 'arbitrary' }],
    ['name', { name: '任意奖励' }],
    ['metric', { metric: 'COIN' }],
    ['source event', { sourceEventType: 'client.claimed' }],
  ]) {
    it(`rejects changes to the fixed ${label}`, () => {
      assert.throws(
        () => assertFixedGrowthRuleUpdate(rule(), rule(change)),
        error => error.code === 'GROWTH_RULE_IMMUTABLE',
      )
    })
  }

  it('refuses to configure unknown or already-corrupted rows', () => {
    assert.throws(
      () => assertFixedGrowthRuleUpdate(rule({ ruleKey: 'custom' }), rule({ ruleKey: 'custom' })),
      error => error.code === 'GROWTH_RULE_NOT_CONFIGURABLE',
    )
    assert.throws(
      () => assertFixedGrowthRuleUpdate(rule({ metric: 'COIN' }), rule({ metric: 'COIN' })),
      error => error.code === 'GROWTH_RULE_NOT_CONFIGURABLE',
    )
  })
})
