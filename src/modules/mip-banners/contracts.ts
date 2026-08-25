import type {
  MipAdminBanner,
  MipBannerAdminPage,
  MipBannerAdminSession,
  MipBannerStatus,
  MipBannerTargetType,
  MipBannerUploadedImage,
  MipPublicBanner,
} from './types'
import { MipBannerError } from './types'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses = new Set<MipBannerStatus>(['ACTIVE', 'INACTIVE', 'DELETED'])
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

function validIsoOrEmpty(value: unknown) {
  return value === '' || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

export function parsePublicBanner(value: unknown, requireImage = true): MipPublicBanner {
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
    || (requireImage && !value.imageUrl)
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

export function parseAdminBanner(value: unknown): MipAdminBanner {
  if (!record(value)) {
    return invalid('Banner 信息')
  }
  const publicBanner = parsePublicBanner(Object.fromEntries(
    ['id', 'title', 'accessibilityLabel', 'imageUrl', 'targetType', 'targetValue', 'sortOrder']
      .map(key => [key, value[key]]),
  ), false)
  const adminKeys = [
    ...Object.keys(publicBanner),
    'imageAssetId',
    'imageWidth',
    'imageHeight',
    'imageStatus',
    'status',
    'version',
    'activatedAt',
    'deletedAt',
    'updatedAt',
  ]
  if (!hasOnlyKeys(value, adminKeys)
    || typeof value.imageAssetId !== 'string'
    || !uuidPattern.test(value.imageAssetId)
    || !Number.isSafeInteger(value.imageWidth)
    || Number(value.imageWidth) < 1
    || !Number.isSafeInteger(value.imageHeight)
    || Number(value.imageHeight) < 1
    || typeof value.imageStatus !== 'string'
    || !statuses.has(value.status as MipBannerStatus)
    || !Number.isSafeInteger(value.version)
    || Number(value.version) < 1
    || !validIsoOrEmpty(value.activatedAt)
    || !validIsoOrEmpty(value.deletedAt)
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    return invalid('Banner 信息')
  }
  return value as unknown as MipAdminBanner
}

export function parseAdminBannerPage(value: unknown): MipBannerAdminPage {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'truncated'])
    || !Array.isArray(value.items)
    || typeof value.truncated !== 'boolean') {
    return invalid('Banner 列表')
  }
  return { items: value.items.map(parseAdminBanner), truncated: value.truncated }
}

export function parseBannerAdminSession(value: unknown): MipBannerAdminSession {
  if (!record(value)
    || !hasOnlyKeys(value, ['capability', 'roleKey'])
    || value.capability !== 'banners.manage'
    || !['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'].includes(String(value.roleKey))) {
    return invalid('管理权限')
  }
  return {
    capability: 'banners.manage',
    roleKey: value.roleKey as MipBannerAdminSession['roleKey'],
  }
}

export function parseBannerDeletion(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['bannerId', 'deleted'])
    || typeof value.bannerId !== 'string'
    || !uuidPattern.test(value.bannerId)
    || value.deleted !== true) {
    return invalid('删除结果')
  }
  return { bannerId: value.bannerId, deleted: true as const }
}

export function parseBannerUploadedImage(value: unknown): MipBannerUploadedImage {
  if (!record(value)
    || !hasOnlyKeys(value, ['assetId', 'purpose', 'imageUrl', 'width', 'height'])
    || typeof value.assetId !== 'string'
    || !uuidPattern.test(value.assetId)
    || value.purpose !== 'BANNER'
    || typeof value.imageUrl !== 'string'
    || !value.imageUrl
    || !Number.isSafeInteger(value.width)
    || Number(value.width) < 750
    || !Number.isSafeInteger(value.height)
    || Number(value.height) < 300) {
    return invalid('图片上传结果')
  }
  const ratio = Number(value.width) / Number(value.height)
  if (ratio < 1.8 || ratio > 3.2) {
    return invalid('图片上传结果')
  }
  return {
    assetId: value.assetId,
    imageUrl: value.imageUrl,
    width: Number(value.width),
    height: Number(value.height),
  }
}
