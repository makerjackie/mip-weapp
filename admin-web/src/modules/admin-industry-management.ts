import type { AdminRequestInput } from '../domain/contracts.ts'
import type { AdminRequest } from './admin-read-contracts.ts'
import type { OperationField, OperationValues } from './admin-operation-ui.ts'
import type { AdminOperationLaunchContext } from './admin-row-operations.ts'

export const INDUSTRY_CAPABILITY = 'industries.manage'
export const ADMIN_INDUSTRY_MUTATION_ACTIONS = ['mip.admin.industries.save', 'mip.admin.industries.changeStatus'] as const
export type AdminIndustryMutationAction = typeof ADMIN_INDUSTRY_MUTATION_ACTIONS[number]
export interface IndustryCatalogItem {
  id: string
  label: string
  parentId: string | null
  selectable: boolean
  popular: boolean
  enabled: boolean
  sortOrder: number
  version: number
}

export async function loadIndustryCatalog(request: AdminRequest): Promise<IndustryCatalogItem[]> {
  const value = await request('mip.admin.industries.list') as { items?: unknown }
  if (!value || !Array.isArray(value.items)) throw new Error('行业服务返回了无效目录')
  const items = value.items as IndustryCatalogItem[]
  if (items.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.label !== 'string' || !item.label
    || !(item.parentId === null || typeof item.parentId === 'string')
    || ['selectable', 'popular', 'enabled'].some(key => typeof item[key as keyof IndustryCatalogItem] !== 'boolean')
    || !Number.isSafeInteger(item.sortOrder) || !Number.isSafeInteger(item.version) || item.version < 1)) throw new Error('行业服务返回了无效目录')
  return items
}

export async function createIndustryMutationDefinition(action: AdminIndustryMutationAction, targetId: string, launch: AdminOperationLaunchContext, request: AdminRequest) {
  const items = await loadIndustryCatalog(request)
  const current = targetId ? items.find(item => item.id === targetId) : undefined
  if (targetId && !current) throw new Error('行业已不存在，请刷新列表')
  const values: OperationValues = { label: '', sortOrder: 0, popular: false, ...current, ...launch.values }
  const secondary = current ? current.selectable : Boolean(values.parentId)
  if (action === 'mip.admin.industries.save' && !current && secondary && !items.some(item => !item.selectable)) throw new Error('请先创建一级分类')
  const fields: OperationField[] = action === 'mip.admin.industries.changeStatus' ? [] : [
    { key: 'label', label: secondary ? '行业名称' : '分类名称', kind: 'text', required: true, maxLength: 80 },
    ...(secondary ? [{ key: 'parentId', label: '一级分类', kind: 'select' as const, required: true, options: items.filter(item => !item.selectable && !item.parentId).map(item => ({ value: item.id, label: item.label + (item.enabled ? '' : '（已停用）') })) }] : []),
    { key: 'sortOrder', label: '排序', kind: 'number', required: true, min: 0, max: 100000, extra: '数字越小越靠前' },
    ...(secondary ? [{ key: 'popular', label: '设为热门行业', kind: 'boolean' as const }] : []),
  ]
  const version = launch.expectedVersion ?? current?.version
  const definition = {
    action, capability: INDUSTRY_CAPABILITY,
    title: action === 'mip.admin.industries.changeStatus' ? `${values.enabled ? '启用' : '停用'}“${current?.label || '行业'}”` : `${targetId ? '编辑' : '新增'}${secondary ? '行业' : '一级分类'}`,
    description: action === 'mip.admin.industries.changeStatus' ? '状态变更后，相关页面将读取最新行业目录。' : targetId ? '修改名称、排序或热门设置，保留已有资料的行业关联。' : '保存后默认停用，确认内容后可在列表中启用。',
    fields, values,
    buildInput(next: OperationValues): AdminRequestInput | null {
      if (action === 'mip.admin.industries.changeStatus') {
        return targetId && Number.isSafeInteger(version) && typeof values.enabled === 'boolean' ? { tagId: targetId, expectedVersion: version, enabled: values.enabled } : null
      }
      const label = typeof next.label === 'string' ? next.label.trim() : ''
      const sortOrder = typeof next.sortOrder === 'number' ? next.sortOrder : Number(String(next.sortOrder || '').trim())
      const parentId = secondary && typeof next.parentId === 'string' ? next.parentId : null
      if (!label || label.length > 80 || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000
        || (secondary && !items.some(item => item.id === parentId && !item.selectable)) || (targetId && !Number.isSafeInteger(version))) return null
      return { ...(targetId ? { tagId: targetId, expectedVersion: version } : {}), label, parentId, popular: secondary && next.popular === true, sortOrder }
    },
  }
  return definition
}
