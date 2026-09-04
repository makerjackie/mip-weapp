import type { MipBannerTargetType, MipPublicBanner } from './types'
import { MipBannerError } from './types'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const targetTypes = new Set<MipBannerTargetType>(['MINIPROGRAM_PATH', 'ARTICLE_URL'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(label: string): never {
  throw new MipBannerError('INVALID_RESPONSE', `Banner 服务返回了无效的${label}`)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

export function parsePublicBanner(value: unknown): MipPublicBanner {
  const keys = [
    'id',
    'title',
    'accessibilityLabel',
    'imageUrl',
    'targetType',
    'targetValue',
    'sortOrder',
  ]
  if (!record(value)
    || !hasOnlyKeys(value, keys)
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 100
    || typeof value.accessibilityLabel !== 'string'
    || value.accessibilityLabel.length < 1
    || value.accessibilityLabel.length > 120
    || typeof value.imageUrl !== 'string'
    || !value.imageUrl
    || !targetTypes.has(value.targetType as MipBannerTargetType)
    || typeof value.targetValue !== 'string'
    || !value.targetValue
    || !Number.isSafeInteger(value.sortOrder)
    || Number(value.sortOrder) < 0) {
    return invalid('Banner 信息')
  }
  return value as unknown as MipPublicBanner
}

export function parsePublicBannerList(value: unknown): MipPublicBanner[] {
  if (!Array.isArray(value)) {
    return invalid('Banner 列表')
  }
  return value.map(item => parsePublicBanner(item))
}
