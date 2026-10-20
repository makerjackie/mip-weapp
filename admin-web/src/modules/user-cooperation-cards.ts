import type { AdminRequest } from './admin-read-contracts'
import { record } from './admin-read-formatters.ts'

export interface CooperationSchema { key: string; roleKey: string; label: string; scores: string[]; menu: string[] }
export interface CooperationCard {
  id?: string; userId: string; cardType: string; expectedVersion: number; status: string
  realName: string; gameName: string; cardSummary: string; targetSummary: string; referralNeeded: string
  quirks: string; rootCause: string; prevention: string; cooperationValue: string
  menuFields: Record<string, string>; abilityScores: Array<{ key: string; score: number }>
  modifiedBy?: string; modifiedAt?: string
}
export const cooperationTextFields = [
  ['realName', '姓名'], ['gameName', '游戏名'], ['cardSummary', '卡型说明'], ['targetSummary', '我的目标'],
  ['referralNeeded', '需要的支持或引荐'], ['quirks', '臭毛病（外显）'], ['rootCause', '病因（内在）'],
  ['prevention', '预防发作建议（行为）'], ['cooperationValue', '和我合作最大的价值'],
] as const

export async function loadUserCooperationCards(userId: string, request: AdminRequest): Promise<{ cards: CooperationCard[]; schemas: CooperationSchema[] }> {
  const payload = record(await request('mip.admin.cooperationCards.get', { userId }))
  if (payload.userId !== userId || !Array.isArray(payload.cards) || !Array.isArray(payload.cardTypes) || payload.cardTypes.length !== 6) throw new Error('合作卡数据不完整，请重新加载。')
  const schemas = payload.cardTypes as CooperationSchema[]
  if (schemas.some(schema => !schema.key || !schema.label || !Array.isArray(schema.menu) || !Array.isArray(schema.scores) || schema.scores.length !== 6)) throw new Error('合作卡字段配置不完整。')
  const cards = payload.cards as CooperationCard[]
  if (cards.some(card => card.userId !== userId || !Number.isInteger(card.expectedVersion) || !schemas.some(schema => schema.key === card.cardType))) throw new Error('合作卡归属或版本不匹配。')
  return { cards, schemas }
}

export function emptyCooperationCard(userId: string, schema: CooperationSchema): CooperationCard {
  return { userId, cardType: schema.key, expectedVersion: 0, status: 'DRAFT',
    ...Object.fromEntries(cooperationTextFields.map(([key]) => [key, ''])) as Pick<CooperationCard, typeof cooperationTextFields[number][0]>,
    menuFields: Object.fromEntries(schema.menu.map(key => [key, ''])), abilityScores: schema.scores.map(key => ({ key, score: 0 })),
  }
}

export function rebaseCooperationCard(before: CooperationCard, local: CooperationCard, latest: CooperationCard, schema: CooperationSchema): CooperationCard {
  return { ...latest,
    ...Object.fromEntries(cooperationTextFields.map(([key]) => [key, local[key] === before[key] ? latest[key] : local[key]])),
    status: local.status === before.status ? latest.status : local.status,
    menuFields: Object.fromEntries(schema.menu.map(key => [key, local.menuFields[key] === before.menuFields[key] ? latest.menuFields[key] : local.menuFields[key]])),
    abilityScores: schema.scores.map(key => {
      const score = (card: CooperationCard) => card.abilityScores.find(item => item.key === key)?.score || 0
      return { key, score: score(local) === score(before) ? score(latest) : score(local) }
    }),
  }
}

/** Project only editable fields; actor, version and user identity come from the loaded object. */
export function saveUserCooperationCard(card: CooperationCard, values: CooperationCard, schema: CooperationSchema, key: string, request: AdminRequest) {
  const input = { userId: card.userId, cardType: card.cardType, expectedVersion: card.expectedVersion, idempotencyKey: key,
    ...Object.fromEntries(cooperationTextFields.map(([field]) => [field, values[field]])),
    menuFields: Object.fromEntries(schema.menu.map(field => [field, values.menuFields[field]])),
    abilityScores: schema.scores.map((field, index) => ({ key: field, score: values.abilityScores[index]?.score })), status: values.status,
  }
  return request('mip.admin.cooperationCards.save', input)
}
