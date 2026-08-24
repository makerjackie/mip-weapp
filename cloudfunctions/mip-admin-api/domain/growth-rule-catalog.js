'use strict'

const FIXED_GROWTH_RULES = Object.freeze({
  profile_completed: Object.freeze({
    name: '完善资料',
    metric: 'EXPERIENCE',
    sourceEventType: 'identity.profile_completed',
  }),
  event_attended: Object.freeze({
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    sourceEventType: 'event.checked_in',
  }),
  referral_confirmed: Object.freeze({
    name: '确认有效引荐',
    metric: 'CONTRIBUTION',
    sourceEventType: 'referral.confirmed',
  }),
  case_published: Object.freeze({
    name: '发布超级案例',
    metric: 'EXPERIENCE',
    sourceEventType: 'super_case.published',
  }),
})

function assertFixedGrowthRuleUpdate(current, draft) {
  const definition = FIXED_GROWTH_RULES[current?.ruleKey]
  if (!definition || !matchesDefinition(current, definition)) {
    throw codeError('GROWTH_RULE_NOT_CONFIGURABLE')
  }
  if (!draft
    || draft.ruleKey !== current.ruleKey
    || !matchesDefinition(draft, definition)) {
    throw codeError('GROWTH_RULE_IMMUTABLE')
  }
  return definition
}

function matchesDefinition(value, definition) {
  return value?.name === definition.name
    && value?.metric === definition.metric
    && value?.sourceEventType === definition.sourceEventType
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { FIXED_GROWTH_RULES, assertFixedGrowthRuleUpdate }
