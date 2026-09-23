'use strict'
const { CAPABILITIES } = require('./capabilities')
const { AdminError, requiredId, stableKey, text } = require('./validation')
const CARD_TYPES = {
  PIMP: { roleKey: 'connector', label: '皮条客', scores: ['开拓人脉', '引荐人脉', '长期维护', '引荐商机', '卖点提炼', '跨圈交际'], menu: ['圈子名称', '圈内身份', '圈内年限', '圈子特点简述'] },
  BUSINESS: { roleKey: 'business_builder', label: '生意佬', scores: ['商机洞察', '财务测算', '盈利建模', '资源整合', '利益统筹', '合作谈判'], menu: ['行业', '行业年限', '卖点'] },
  RICH: { roleKey: 'capital_operator', label: '暴发户', scores: ['投资洞察', '上市规划', '股权规划', '投融策划', '融资达成', '资源整合'], menu: ['擅长领域', '领域年限', '成就'] },
  PLANNER: { roleKey: 'strategist', label: '狗策划', scores: ['项目调研', '项目定位', '创新创意', '方法设计', '提案竞标', '落地规划'], menu: ['类型', '擅长领域', '卖点'] },
  DESIGNER: { roleKey: 'visual_designer', label: '死美工', scores: ['视觉策略', '视觉设计', '素材搜寻', '视觉落地', '视觉管理', '提案竞标'], menu: ['类型', '擅长领域', '卖点'] },
  NANNY: { roleKey: 'delivery_lead', label: '老保姆', scores: ['目标计划', '执行统筹', '进度复盘', '沟通机制', '标准研发', '应急沟通'], menu: ['类型', '擅长领域', '卖点'] },
}
const LEGACY_SCORE_KEYS = ['business_development', 'resource_integration', 'capital_operation', 'strategy_planning', 'visual_design', 'delivery_management']
function cardDraft(input) {
  const schema = CARD_TYPES[input.cardType]
  if (!schema) throw new AdminError('VALIDATION_FAILED', '合作卡类型无效')
  const scores = input.abilityScores
  if (!Array.isArray(scores) || scores.length !== 6 || schema.scores.some(key => !scores.some(item => item?.key === key))
    || scores.some(item => !Number.isInteger(item.score) || item.score < 1 || item.score > 5)) throw new AdminError('VALIDATION_FAILED', '请完成六项 1 至 5 星评分')
  const menu = input.menuFields
  if (!menu || typeof menu !== 'object' || Array.isArray(menu) || Object.keys(menu).some(key => !schema.menu.includes(key))) throw new AdminError('VALIDATION_FAILED', '合作卡菜单字段无效')
  const menuFields = Object.fromEntries(schema.menu.map(key => [key, text(menu[key], 500, { required: true, label: key })]))
  const status = ({ ACTIVE: 'PUBLISHED', INACTIVE: 'UNPUBLISHED' })[input.status] || input.status || 'DRAFT'
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(status)) throw new AdminError('VALIDATION_FAILED', '合作卡状态无效')
  const draft = { cardType: input.cardType, roleKey: schema.roleKey, status, menuFields,
    abilityScores: Object.fromEntries(schema.scores.map((key, index) => [LEGACY_SCORE_KEYS[index], scores.find(item => item.key === key).score])) }
  for (const key of ['realName', 'gameName', 'cardSummary', 'targetSummary', 'referralNeeded', 'quirks', 'rootCause', 'prevention', 'cooperationValue']) {
    draft[key] = text(input[key], ['realName', 'gameName'].includes(key) ? 64 : 500, { required: ['cardSummary', 'targetSummary'].includes(key), label: key })
  }
  return draft
}
function createCooperationCards({ repository, access, contentSafety = async () => 'ERROR' }) {
  async function authorizeUser(caller, input) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const auth = await access.userAuthorization(context, userId, CAPABILITIES.USER_CONTENT_MODERATE)
    return { context, userId, ...auth }
  }
  async function getCooperationCard(caller, input = {}) {
    const { context, userId } = await authorizeUser(caller, input)
    const cards = await repository.getCooperationCards(context.caller.appId, userId)
    return { userId, cards, cardTypes: Object.entries(CARD_TYPES).map(([key, schema]) => ({ key, ...schema })) }
  }
  async function saveCooperationCard(caller, input = {}) {
    const { context, userId, scope, grant } = await authorizeUser(caller, input)
    const draft = cardDraft(input)
    const expectedVersion = Number(input.expectedVersion)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new AdminError('VALIDATION_FAILED', '合作卡版本无效')
    const safety = await contentSafety({ ...draft, abilityScores: undefined }, caller)
    const contentSafetyStatus = ['PASSED', 'APPROVED'].includes(safety) ? 'APPROVED' : safety === 'REJECTED' ? 'REJECTED' : 'ERROR'
    if (draft.status === 'PUBLISHED' && contentSafetyStatus !== 'APPROVED') throw new AdminError('CONTENT_SAFETY_REQUIRED', '内容安全检查未通过，暂不能发布')
    return repository.saveCooperationCard({ appId: context.caller.appId, actorUserId: context.caller.userId,
      userId, expectedVersion, draft, contentSafetyStatus, authorizedScope: scope,
      idempotencyKey: stableKey(input.idempotencyKey, '请求', 128),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.USER_CONTENT_MODERATE),
      audit: cardId => access.audit(context, grant, { ...scope, action: 'admin.cooperation_cards.save',
        resourceType: 'COOPERATION_CARD', resourceId: cardId, metadata: { ownerUserId: userId, cardType: draft.cardType, status: draft.status } }),
    })
  }
  return { getCooperationCard, saveCooperationCard }
}
module.exports = { createCooperationCards, CARD_TYPES, LEGACY_SCORE_KEYS, cardDraft }
