'use strict'

const { CARD_TYPES } = require('./cooperation-cards')
const labels = {
  RECOMMEND: '愿意', NOT_RECOMMEND: '不愿意', JOIN_NOW: '想立即加入', LEARN_MORE: '想先了解', NOT_INTERESTED: '暂不考虑',
  ATTEND_EVENT: '参与活动', COMMUNITY_CHAT: '社群交流', MATCH_OPPORTUNITIES: '匹配合作机会', PRIVATE: '仅私密保存',
  ...Object.fromEntries(Object.values(CARD_TYPES).map(card => [card.roleKey, card.label])),
}
const label = value => typeof value === 'string' && value ? labels[value] || value : '—'
const list = value => Array.isArray(value) && value.length ? value.map(label).join('、') : '—'

// One projection serves the authorized detail response and its Excel export.
function feedbackDisplayFields(item) {
  const answers = item.answers && typeof item.answers === 'object' && !Array.isArray(item.answers) ? item.answers : {}
  return {
    wouldRecommend: label(answers.recommendation), capabilityRoles: list(answers.roleKeys),
    resources: typeof item.body === 'string' && item.body ? item.body : '—',
    joinMipIntent: label(answers.joinIntent), discoverySource: list(answers.explorationMethods), rosterConsent: label(answers.rosterConsent),
  }
}
module.exports = { feedbackDisplayFields }
