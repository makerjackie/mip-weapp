import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadUserCooperationCards, rebaseCooperationCard, saveUserCooperationCard } from './user-cooperation-cards.ts'
import type { AdminRequest } from './admin-read-contracts'
const require = createRequire(import.meta.url)
const { CARD_TYPES } = require('../../../cloudfunctions/mip-admin-api/domain/cooperation-cards.js')
const { createCooperationCardRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/cooperation-cards.js')

async function fixture() {
  const repository = createCooperationCardRepository({ query: async () => [{ id: 'card-a', card_type: 'PLANNER', role_key: 'strategist', positioning: '策略说明', target_summary: '项目目标', referral_needed: '寻找品牌方', ability_scores_json: JSON.stringify({ business_development: 0, resource_integration: 2, capital_operation: 3, strategy_planning: 4, visual_design: 5, delivery_management: 1 }), menu_fields_json: JSON.stringify({ 类型: '品牌策划', 擅长领域: '商业', 卖点: '完整交付' }), status: 'DRAFT', version: 3 }] })
  const cards = JSON.parse(JSON.stringify(await repository.getCooperationCards('app-a', 'user-a')))
  const schemas = Object.entries(CARD_TYPES).map(([key, value]) => ({ key, ...value as object }))
  const request: AdminRequest = async <T>() => ({ userId: 'user-a', cards, cardTypes: schemas }) as T
  return loadUserCooperationCards('user-a', request)
}
it('consumes the real repository DTO and six server schemas without inventing ratings', async () => {
  const { cards, schemas } = await fixture()
  assert.equal(schemas.length, 6)
  assert.equal(cards[0].abilityScores[0].score, 0)
  assert.equal(cards[0].abilityScores[0].key, '项目调研')
  assert.equal(cards[0].menuFields.类型, '品牌策划')
})
it('saves only the selected card with its loaded version and stable request key', async () => {
  const { cards, schemas } = await fixture(), item = cards[0], schema = schemas.find(schema => schema.key === 'PLANNER')!
  let call: unknown
  const request: AdminRequest = async <T>(_action: string, input?: unknown) => { call = input; return {} as T }
  await saveUserCooperationCard(item, { ...item, targetSummary: '改后的目标', abilityScores: item.abilityScores.map(score => ({ ...score, score: 3 })) }, schema, 'request-1', request)
  assert.deepEqual(call, { userId: 'user-a', cardType: 'PLANNER', expectedVersion: 3, idempotencyKey: 'request-1', realName: '', gameName: '', cardSummary: '策略说明', targetSummary: '改后的目标', referralNeeded: '寻找品牌方', quirks: '', rootCause: '', prevention: '', cooperationValue: '', menuFields: item.menuFields, abilityScores: schema.scores.map(key => ({ key, score: 3 })), status: 'DRAFT' })
})
it('rebases only edited fields and keeps another operator’s changes', async () => {
  const { cards, schemas } = await fixture(), before = cards[0], schema = schemas.find(schema => schema.key === 'PLANNER')!
  const latest = { ...before, expectedVersion: 4, targetSummary: '同事修改目标', menuFields: { ...before.menuFields, 卖点: '同事修改卖点' } }
  const rebased = rebaseCooperationCard(before, { ...before, referralNeeded: '我的新需求' }, latest, schema)
  assert.equal(rebased.targetSummary, '同事修改目标')
  assert.equal(rebased.menuFields.卖点, '同事修改卖点')
  assert.equal(rebased.referralNeeded, '我的新需求')
  assert.equal(rebased.expectedVersion, 4)
})
it('rejects another user’s collection and malformed server schemas', async () => {
  const request: AdminRequest = async <T>() => ({ userId: 'someone-else', cards: [], cardTypes: [] }) as T
  await assert.rejects(loadUserCooperationCards('user-a', request), /数据不完整/)
})
