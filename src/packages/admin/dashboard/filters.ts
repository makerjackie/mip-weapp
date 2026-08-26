import type {
  AdminBranch,
  AdminCapabilityGrant,
  AdminDashboardOverviewPeriodInput,
  AdminDashboardOverviewScopeInput,
} from '../../../modules/mip-admin'

export interface AdminDashboardScopeOption {
  key: string
  label: string
  input: AdminDashboardOverviewScopeInput
}

export const initialDashboardScopeOptions: AdminDashboardScopeOption[] = [{
  key: 'AUTHORIZED',
  label: '授权范围',
  input: { type: 'AUTHORIZED' },
}]

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  const instant = Date.UTC(year, month - 1, day)
  const date = new Date(instant)
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    return null
  }
  return instant
}

export function dashboardShanghaiToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

export function validateDashboardCustomPeriod(
  startDate: string,
  endDate: string,
  today = dashboardShanghaiToday(),
) {
  const start = calendarDate(startDate)
  const end = calendarDate(endDate)
  const current = calendarDate(today)
  if (start === null || end === null || current === null) {
    return '请选择有效的开始日期和结束日期'
  }
  if (start > end) {
    return '开始日期不能晚于结束日期'
  }
  if (end > current) {
    return '结束日期不能晚于今天'
  }
  if (Math.floor((end - start) / 86_400_000) + 1 > 366) {
    return '自定义时间范围不能超过 366 天'
  }
  return ''
}

export function customDashboardPeriod(
  startDate: string,
  endDate: string,
): AdminDashboardOverviewPeriodInput {
  return { preset: 'CUSTOM', startDate, endDate }
}

export function canLoadDashboardBranchCatalog(grants: AdminCapabilityGrant[]) {
  return grants.some(grant => (
    grant.capability === 'branches.manage'
    && grant.scopeType === 'PLATFORM'
    && grant.scopeId === null
  ))
}

export function buildDashboardScopeOptions(
  grants: AdminCapabilityGrant[],
  branches: AdminBranch[] | null,
) {
  const dashboardGrants = grants.filter(grant => grant.capability === 'admin.dashboard')
  const platformAllowed = dashboardGrants.some(grant => (
    grant.scopeType === 'PLATFORM' && grant.scopeId === null
  ))
  const directBranchIds = new Set(dashboardGrants
    .filter(grant => grant.scopeType === 'BRANCH' && Boolean(grant.scopeId))
    .map(grant => String(grant.scopeId)))
  const branchById = new Map((branches || []).map(branch => [branch.id, branch]))
  const branchIds = new Set(directBranchIds)
  if (platformAllowed && branches) {
    for (const branch of branches) {
      branchIds.add(branch.id)
    }
  }
  const options: AdminDashboardScopeOption[] = [...initialDashboardScopeOptions]
  if (platformAllowed) {
    options.push({ key: 'PLATFORM', label: '平台范围', input: { type: 'PLATFORM' } })
  }
  const sortedBranchIds = [...branchIds].sort((left, right) => {
    const leftBranch = branchById.get(left)
    const rightBranch = branchById.get(right)
    if (leftBranch && rightBranch) {
      return leftBranch.name.localeCompare(rightBranch.name, 'zh-CN')
    }
    return leftBranch ? -1 : rightBranch ? 1 : left.localeCompare(right)
  })
  let unnamedIndex = 0
  for (const branchId of sortedBranchIds) {
    const branch = branchById.get(branchId)
    unnamedIndex += branch ? 0 : 1
    const genericLabel = directBranchIds.size === 1
      ? '当前城市分会'
      : `授权城市分会 ${unnamedIndex}`
    options.push({
      key: `BRANCH:${branchId}`,
      label: branch
        ? `${branch.name}${branch.status === 'INACTIVE' ? '（停用）' : ''}`
        : genericLabel,
      input: { type: 'BRANCH', id: branchId },
    })
  }
  return options
}
