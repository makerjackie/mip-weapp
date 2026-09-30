import type { AdminRequest } from './admin-read-contracts'
import { record } from './admin-read-formatters.ts'
export interface RoleTemplate { id: string; name: string; description: string; baseRoleKey: string; capabilities: string[]; status: 'ACTIVE' | 'INACTIVE'; version: number; bindingCount: number }
export interface RoleTemplateCatalog { items: RoleTemplate[]; baseRoles: Array<{ key: string; allowedCapabilities: string[] }>; bindingWritesEnabled: boolean }
export const roleTemplateLabels: Record<string, string> = { PLATFORM_OPERATIONS: '平台运营', PLATFORM_FINANCE: '平台财务', BRANCH_ADMIN: '服务器管理员', EVENT_OWNER: '活动负责人', EVENT_MANAGER: '活动管理员', EVENT_STAFF: '活动工作人员' }
export function roleTemplateFromDto(value: unknown): RoleTemplate {
  const row = record(value)
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || !roleTemplateLabels[String(row.baseRoleKey)]
    || !Array.isArray(row.capabilities) || row.capabilities.some(cap => typeof cap !== 'string')
    || !['ACTIVE', 'INACTIVE'].includes(String(row.status)) || !Number.isSafeInteger(row.version)) throw new Error('岗位模板字段不完整')
  return { id: row.id, name: row.name, description: String(row.description || ''), baseRoleKey: String(row.baseRoleKey), capabilities: row.capabilities as string[],
    status: row.status as RoleTemplate['status'], version: Number(row.version), bindingCount: Number(row.bindingCount || 0) }
}
export async function loadRoleTemplates(request: AdminRequest): Promise<RoleTemplateCatalog> {
  const row = record(await request('mip.admin.roles.templates.list'))
  if (!Array.isArray(row.items) || !Array.isArray(row.baseRoles)) throw new Error('岗位目录暂不可用')
  return { items: row.items.map(roleTemplateFromDto), baseRoles: row.baseRoles.map(value => {
    const base = record(value)
    if (!roleTemplateLabels[String(base.key)] || !Array.isArray(base.allowedCapabilities) || base.allowedCapabilities.some(cap => typeof cap !== 'string')) throw new Error('岗位权限目录无效')
    return { key: String(base.key), allowedCapabilities: base.allowedCapabilities as string[] }
  }), bindingWritesEnabled: row.bindingWritesEnabled === true }
}
