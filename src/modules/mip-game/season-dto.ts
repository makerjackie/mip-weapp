import type { GameRules, GameSeason } from './types'
import { MipGameError } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(): never {
  throw new MipGameError('SERVICE_UNAVAILABLE', '赛季服务返回了无效响应', true)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid()
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    invalid()
  }
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    invalid()
  }
  return value
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid()
  }
  return Number(value)
}

function timestamp(value: unknown) {
  const source = text(value, 40, true)
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) {
    invalid()
  }
  return date.toISOString()
}

function parseRules(value: unknown): GameRules {
  const rules = record(value)
  exact(rules, ['scoreMetric', 'headquartersThresholds'])
  if (rules.scoreMetric !== 'EXPERIENCE'
    || !Array.isArray(rules.headquartersThresholds)
    || rules.headquartersThresholds.length < 1
    || rules.headquartersThresholds.length > 8) {
    invalid()
  }
  let previousMinimum = -1
  const headquartersThresholds = rules.headquartersThresholds.map((value, index) => {
    const threshold = record(value)
    exact(threshold, ['level', 'minimumExperience', 'label'])
    const level = integer(threshold.level, 1, 8)
    const minimumExperience = integer(threshold.minimumExperience, 0)
    if (level !== index + 1 || minimumExperience <= previousMinimum) {
      invalid()
    }
    previousMinimum = minimumExperience
    return {
      level,
      minimumExperience,
      label: text(threshold.label, 80, true),
    }
  })
  if (headquartersThresholds[0]?.minimumExperience !== 0) {
    invalid()
  }
  return { scoreMetric: 'EXPERIENCE', headquartersThresholds }
}

export function parseGameSeason(value: unknown, expectedId?: string): GameSeason {
  const item = record(value)
  exact(item, [
    'id',
    'seasonKey',
    'name',
    'summary',
    'rulesText',
    'rules',
    'periodKind',
    'startsAt',
    'endsAt',
    'status',
    'version',
  ])
  const id = text(item.id, 36, true)
  const startsAt = timestamp(item.startsAt)
  const endsAt = timestamp(item.endsAt)
  if (!UUID_PATTERN.test(id)
    || (expectedId && id !== expectedId)
    || !['HALF_YEAR', 'YEAR', 'CUSTOM'].includes(String(item.periodKind))
    || !['DRAFT', 'ACTIVE', 'CLOSED'].includes(String(item.status))
    || Date.parse(startsAt) >= Date.parse(endsAt)) {
    invalid()
  }
  return {
    id,
    seasonKey: text(item.seasonKey, 64, true),
    name: text(item.name, 100, true),
    summary: text(item.summary, 500),
    rulesText: text(item.rulesText, 4000, true),
    rules: parseRules(item.rules),
    periodKind: item.periodKind as GameSeason['periodKind'],
    startsAt,
    endsAt,
    status: item.status as GameSeason['status'],
    version: integer(item.version, 1),
  }
}

export function parseGameSeasonPage(value: unknown): { items: GameSeason[] } {
  const page = record(value)
  exact(page, ['items'])
  if (!Array.isArray(page.items) || page.items.length > 100) {
    invalid()
  }
  const items = page.items.map(item => parseGameSeason(item))
  if (new Set(items.map(item => item.id)).size !== items.length) {
    invalid()
  }
  return { items }
}
