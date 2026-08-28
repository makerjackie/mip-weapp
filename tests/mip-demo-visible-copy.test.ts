import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8')) as unknown
const userFacingKeys = new Set([
  'name',
  'title',
  'summary',
  'description',
  'notices',
  'address',
  'nickname',
  'body',
  'bodyText',
  'authorName',
  'reason',
  'adjustmentReason',
  'displayName',
  'rulesText',
  'redemptionRulesText',
])

function visibleSeedCopy(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(visibleSeedCopy)
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (userFacingKeys.has(key) && typeof child === 'string') {
      return [child]
    }
    return visibleSeedCopy(child)
  })
}

describe('MIP demo visible copy', () => {
  it('keeps internal fixture markers out of user-facing fields', () => {
    expect(visibleSeedCopy(seed).filter(value => /虚构|演示|测试|联调|验收|用于验证/.test(value))).toEqual([])
  })
})
