import type { AdminRequestInput } from '../domain/contracts.ts'
import type {
  AdminDetailRequest,
  AdminDetailView,
} from './admin-details.ts'
import type { OperationField, OperationValues } from './admin-operation-ui.ts'
import type {
  AdminListQuery,
  AdminReadPage,
  AdminRequest,
} from './admin-read-contracts.ts'
import {
  columns,
  formatDateTime,
  numberLabel,
  record,
  valueOf,
} from './admin-read-formatters.ts'

export const ADMIN_BANNER_QUERY_ACTIONS = [
  'mip.admin.banners.session',
  'mip.admin.banners.list',
  'mip.admin.banners.get',
] as const

export const ADMIN_BANNER_MUTATION_ACTIONS = [
  'mip.admin.banners.save',
  'mip.admin.banners.changeStatus',
  'mip.admin.banners.move',
  'mip.admin.banners.delete',
] as const

export type AdminBannerMutationAction = typeof ADMIN_BANNER_MUTATION_ACTIONS[number]

export interface AdminBannerMutationDefinition {
  action: AdminBannerMutationAction
  capability: 'banners.manage'
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
}

const bannerStatusLabels: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  DELETED: '已删除',
}

const targetTypeLabels: Record<string, string> = {
  MINIPROGRAM_PATH: '小程序页面',
  ARTICLE_URL: '公众号文章',
}

export async function loadBannerManagementPage(
  query: AdminListQuery,
  request: AdminRequest,
): Promise<AdminReadPage> {
  const filters = {
    ...(query.query.trim() ? { query: query.query.trim().slice(0, 80) } : {}),
    ...(query.status ? { status: query.status } : {}),
  }
  const [sessionValue, payloadValue] = await Promise.all([
    request('mip.admin.banners.session'),
    request('mip.admin.banners.list', { filters }),
  ])
  const session = record(sessionValue)
  if (session.capability !== 'banners.manage'
    || !['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'].includes(String(session.roleKey || ''))) {
    throw new Error('INVALID_BANNER_SESSION')
  }
  const payload = record(payloadValue)
  const items = Array.isArray(payload.items) ? payload.items.map(record) : []
  return {
    sections: [{
      rows: items.map(item => ({
        detailId: valueOf(item, 'id'),
        title: valueOf(item, 'title'),
        image: bannerImageStatus(item),
        imageUrl: stringValue(item.imageUrl),
        imageAssetId: stringValue(item.imageAssetId),
        imageAlt: stringValue(item.accessibilityLabel) || stringValue(item.title),
        target: `${targetTypeLabel(item.targetType)} · ${stringValue(item.targetValue) || '—'}`,
        order: numberLabel(item.sortOrder),
        updatedAt: formatDateTime(item.updatedAt),
        state: bannerStatusLabel(item.status),
      })),
      columns: columns([
        ['image', '图片'], ['title', '管理名称'], ['target', '跳转目标'],
        ['order', '顺序'], ['updatedAt', '更新时间'], ['state', '状态'],
      ]),
      detailTarget: 'banners',
    }],
    nextCursor: null,
    summary: payload.truncated === true
      ? [{ label: '列表状态', value: '仅显示前 100 条' }]
      : undefined,
  }
}

export async function loadBannerDetail(
  bannerId: string,
  request: AdminDetailRequest,
): Promise<AdminDetailView> {
  const banner = record(await request('mip.admin.banners.get', { bannerId }))
  return {
    route: 'banners',
    title: stringValue(banner.title) || 'Banner 详情',
    subtitle: `${targetTypeLabel(banner.targetType)} · 排序 ${numberLabel(banner.sortOrder)}`,
    status: bannerStatusLabel(banner.status),
    sections: [
      {
        title: 'Banner 图片',
        fields: fields([
          ['图片状态', bannerImageStatus(banner)],
          ['素材 ID', banner.imageAssetId],
          ['当前 imageUrl', banner.imageUrl],
          ['图片尺寸', imageDimensions(banner.imageWidth, banner.imageHeight)],
          ['图片说明', banner.accessibilityLabel],
          ['素材更新', '可从素材上传页获取新的素材 ID'],
        ]),
      },
      {
        title: '跳转与状态',
        fields: fields([
          ['管理名称', banner.title],
          ['跳转类型', targetTypeLabel(banner.targetType)],
          ['跳转地址', banner.targetValue],
          ['排序', numberLabel(banner.sortOrder)],
          ['状态', bannerStatusLabel(banner.status)],
          ['版本', numberLabel(banner.version)],
          ['启用时间', formatDateTime(banner.activatedAt)],
          ['更新时间', formatDateTime(banner.updatedAt)],
        ]),
      },
    ],
    source: { banner },
  }
}

export function createBannerMutationDefinition(
  action: AdminBannerMutationAction,
  targetId = '',
  source: Record<string, unknown> = {},
): AdminBannerMutationDefinition {
  const banner = record(source.banner)
  const expectedVersion = positiveInteger(banner.version)
  if (action === 'mip.admin.banners.save') {
    return definition(
      action,
      targetId ? '编辑 Banner' : '新增 Banner',
      '可先在素材上传页上传 Banner 图片并复制素材 ID；保存后仍需单独启用。',
      [
        { name: 'title', label: '管理名称', kind: 'text', required: true, maxLength: 100 },
        { name: 'accessibilityLabel', label: '图片说明', kind: 'text', required: true, maxLength: 120 },
        { name: 'imageAssetId', label: '图片素材 ID', kind: 'text', required: true },
        { name: 'targetType', label: '跳转类型', kind: 'select', required: true, options: [
          { value: 'MINIPROGRAM_PATH', label: '小程序页面' },
          { value: 'ARTICLE_URL', label: '公众号文章' },
        ] },
        { name: 'targetValue', label: '跳转地址', kind: 'text', required: true, maxLength: 1024, wide: true },
      ],
      {
        bannerId: targetId,
        expectedVersion,
        title: stringValue(banner.title),
        accessibilityLabel: stringValue(banner.accessibilityLabel),
        imageAssetId: stringValue(banner.imageAssetId),
        targetType: stringValue(banner.targetType) || 'MINIPROGRAM_PATH',
        targetValue: stringValue(banner.targetValue) || '/pages/events/index',
      },
    )
  }
  if (action === 'mip.admin.banners.changeStatus') {
    return definition(action, '更新 Banner 状态', '启用时服务端会再次校验图片、跳转地址和内容安全。', [], {
      bannerId: targetId,
      expectedVersion,
      status: banner.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    })
  }
  if (action === 'mip.admin.banners.move') {
    return definition(action, '调整 Banner 顺序', '按当前服务端版本调整相邻 Banner 的展示顺序。', [], {
      bannerId: targetId,
      expectedVersion,
      direction: 'UP',
    })
  }
  return definition(action, '删除 Banner', '删除为软删除，不会物理删除 Banner、素材或审计记录。', [], {
    bannerId: targetId,
    expectedVersion,
  })
}

export function buildBannerMutationInput(
  definitionValue: AdminBannerMutationDefinition,
  values: OperationValues,
): AdminRequestInput | null {
  if (definitionValue.action === 'mip.admin.banners.save') {
    const bannerId = optionalIdentifier(values.bannerId)
    const expectedVersion = positiveInteger(values.expectedVersion)
    const title = requiredText(values.title, 100)
    const accessibilityLabel = requiredText(values.accessibilityLabel, 120)
    const imageAssetId = identifier(values.imageAssetId)
    const targetType = ['MINIPROGRAM_PATH', 'ARTICLE_URL'].includes(String(values.targetType))
      ? String(values.targetType)
      : ''
    const targetValue = requiredText(values.targetValue, 1024)
    if (bannerId === null || !title || !accessibilityLabel || !imageAssetId || !targetType || !targetValue) return null
    const input: AdminRequestInput = {
      banner: { title, accessibilityLabel, imageAssetId, targetType, targetValue },
    }
    if (bannerId) {
      if (!expectedVersion) return null
      input.bannerId = bannerId
      input.expectedVersion = expectedVersion
    }
    return input
  }
  const bannerId = identifier(values.bannerId)
  const expectedVersion = positiveInteger(values.expectedVersion)
  if (!bannerId || !expectedVersion) return null
  if (definitionValue.action === 'mip.admin.banners.changeStatus') {
    const status = String(values.status)
    return ['ACTIVE', 'INACTIVE'].includes(status) ? { bannerId, expectedVersion, status } : null
  }
  if (definitionValue.action === 'mip.admin.banners.move') {
    const direction = String(values.direction)
    return ['UP', 'DOWN'].includes(direction) ? { bannerId, expectedVersion, direction } : null
  }
  return { bannerId, expectedVersion }
}

export function bannerStatusLabel(value: unknown) {
  const code = String(value || '')
  return bannerStatusLabels[code] || code || '—'
}

export function targetTypeLabel(value: unknown) {
  const code = String(value || '')
  return targetTypeLabels[code] || code || '—'
}

export function webBannerImageUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : ''
  }
  catch {
    return ''
  }
}

function bannerImageStatus(banner: Record<string, unknown>) {
  if (!banner.imageAssetId) return '未配置'
  if (webBannerImageUrl(banner.imageUrl)) return '可预览'
  return banner.imageStatus === 'READY' ? '素材就绪，浏览器暂不可预览' : '素材状态待处理'
}

function imageDimensions(widthValue: unknown, heightValue: unknown) {
  const width = Number(widthValue)
  const height = Number(heightValue)
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? `${width} × ${height}`
    : '—'
}

function definition(
  action: AdminBannerMutationAction,
  title: string,
  description: string,
  fieldsValue: readonly OperationField[],
  values: OperationValues,
): AdminBannerMutationDefinition {
  return { action, capability: 'banners.manage', title, description, fields: fieldsValue, values }
}

function fields(entries: Array<[string, unknown]>) {
  return entries.map(([label, value]) => ({
    label,
    value: value === undefined || value === null || value === '' ? '—' : String(value),
  }))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function requiredText(value: unknown, maximum: number) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result && result.length <= maximum ? result : ''
}

function identifier(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)
    ? result
    : ''
}

function optionalIdentifier(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : ''
  return result ? identifier(result) || null : ''
}

function positiveInteger(value: unknown) {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 1 ? result : null
}
