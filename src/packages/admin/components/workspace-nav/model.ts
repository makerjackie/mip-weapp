import type { AdminCapability, AdminCapabilityGrant } from '../../../../modules/mip-admin'

export interface AdminWorkspaceNavItem {
  key: string
  label: string
  route: string
  capabilities: readonly AdminCapability[]
  requiresAll?: boolean
  platformOnly?: boolean
}

export interface AdminWorkspaceNavGroup {
  key: string
  label: string
  items: readonly AdminWorkspaceNavItem[]
}

export interface AdminWorkspaceNavItemView extends AdminWorkspaceNavItem {
  active: boolean
}

export interface AdminWorkspaceNavGroupView {
  key: string
  label: string
  items: AdminWorkspaceNavItemView[]
}

export interface AdminWorkspaceNavigator {
  redirectTo: (options: { url: string }) => unknown
}

export const adminWorkspaceGroups: readonly AdminWorkspaceNavGroup[] = [
  {
    key: 'overview',
    label: '概览',
    items: [
      {
        key: 'dashboard',
        label: '运营概览',
        route: 'packages/admin/dashboard/index',
        capabilities: ['admin.dashboard'],
      },
    ],
  },
  {
    key: 'users',
    label: '用户',
    items: [
      {
        key: 'profiles',
        label: '用户管理',
        route: 'packages/admin/profiles/index',
        capabilities: ['users.read'],
      },
    ],
  },
  {
    key: 'events',
    label: '活动',
    items: [
      {
        key: 'managed-events',
        label: '活动管理',
        route: 'packages/admin/managed-events/index',
        capabilities: ['events.read', 'events.write'],
        requiresAll: true,
      },
      {
        key: 'event-catalogs',
        label: '活动分类与标签',
        route: 'packages/admin/event-catalogs/index',
        capabilities: ['events.catalog.manage'],
        platformOnly: true,
      },
      {
        key: 'event-recaps',
        label: '视频回顾',
        route: 'packages/admin/event-recaps/index',
        capabilities: ['events.recaps.manage'],
        platformOnly: true,
      },
      {
        key: 'event-participants',
        label: '活动参与者',
        route: 'packages/admin/event-participants/index',
        capabilities: ['events.read', 'events.roster.read', 'branches.manage'],
        requiresAll: true,
      },
    ],
  },
  {
    key: 'commerce',
    label: '交易',
    items: [
      {
        key: 'orders',
        label: '订单与退款',
        route: 'packages/admin/orders/index',
        capabilities: ['orders.read'],
      },
      {
        key: 'membership-ledger',
        label: '会员权益台账',
        route: 'packages/admin/membership-ledger/index',
        capabilities: ['memberships.read'],
        platformOnly: true,
      },
    ],
  },
  {
    key: 'content',
    label: '内容',
    items: [
      {
        key: 'announcements',
        label: '公告管理',
        route: 'packages/admin/announcements/index',
        capabilities: ['announcements.manage'],
      },
      {
        key: 'message-campaigns',
        label: '消息管理',
        route: 'packages/admin/message-campaigns/index',
        capabilities: ['messages.manage'],
      },
      {
        key: 'banners',
        label: 'Banner 管理',
        route: 'packages/admin/banners/index',
        capabilities: ['banners.manage'],
      },
      {
        key: 'knowledge',
        label: '知识内容',
        route: 'packages/admin/knowledge/index',
        capabilities: ['knowledge.manage'],
      },
      {
        key: 'opportunities',
        label: '机会管理',
        route: 'packages/admin/opportunities/index',
        capabilities: ['opportunities.moderate'],
      },
      {
        key: 'user-content',
        label: '用户内容',
        route: 'packages/admin/user-content/index',
        capabilities: ['userContent.moderate'],
      },
      {
        key: 'community-reports',
        label: '举报审核',
        route: 'packages/admin/community-reports/index',
        capabilities: ['community.reports.manage'],
      },
    ],
  },
  {
    key: 'growth',
    label: '成长',
    items: [
      {
        key: 'growth-entries',
        label: '成长流水',
        route: 'packages/admin/growth-entries/index',
        capabilities: ['growth.read'],
      },
      {
        key: 'growth-transitions',
        label: '等级变更记录',
        route: 'packages/admin/growth-transitions/index',
        capabilities: ['growth.read'],
      },
      {
        key: 'growth-levels',
        label: '成长设置',
        route: 'packages/admin/growth-levels/index',
        capabilities: ['growth.read'],
      },
      {
        key: 'tasks',
        label: '任务管理',
        route: 'packages/admin/tasks/index',
        capabilities: ['tasks.manage'],
      },
      {
        key: 'badges',
        label: '勋章管理',
        route: 'packages/admin/badges/index',
        capabilities: ['badges.manage'],
      },
      {
        key: 'game',
        label: '赛季管理',
        route: 'packages/admin/game/index',
        capabilities: ['game.manage'],
      },
    ],
  },
  {
    key: 'governance',
    label: '治理',
    items: [
      {
        key: 'branches',
        label: '城市分会',
        route: 'packages/admin/branches/index',
        capabilities: ['branches.manage'],
      },
      {
        key: 'roles',
        label: '角色与权限',
        route: 'packages/admin/roles/index',
        capabilities: ['roles.change'],
      },
      {
        key: 'exceptions',
        label: '运营待办与异常',
        route: 'packages/admin/exceptions/index',
        capabilities: ['operations.exceptions.read', 'messages.delivery.review'],
      },
      {
        key: 'audit',
        label: '审计记录',
        route: 'packages/admin/audit/index',
        capabilities: ['audit.read'],
      },
    ],
  },
]

const activeItemByRoute: Readonly<Record<string, string>> = {
  'packages/admin/dashboard/index': 'dashboard',
  'packages/admin/profiles/index': 'profiles',
  'packages/admin/membership/index': 'profiles',
  'packages/admin/managed-events/index': 'managed-events',
  'packages/admin/event-catalogs/index': 'event-catalogs',
  'packages/admin/event-recaps/index': 'event-recaps',
  'packages/admin/events/index': 'managed-events',
  'packages/admin/event-console/index': 'managed-events',
  'packages/admin/event-managers/index': 'managed-events',
  'packages/admin/event-album/index': 'managed-events',
  'packages/admin/event-feedback/index': 'managed-events',
  'packages/admin/event-comments/index': 'managed-events',
  'packages/admin/event-registrations/index': 'managed-events',
  'packages/admin/exports/index': 'managed-events',
  'packages/admin/event-participants/index': 'event-participants',
  'packages/admin/orders/index': 'orders',
  'packages/admin/membership-ledger/index': 'membership-ledger',
  'packages/admin/announcements/index': 'announcements',
  'packages/admin/announcement-editor/index': 'announcements',
  'packages/admin/message-campaigns/index': 'message-campaigns',
  'packages/admin/banners/index': 'banners',
  'packages/admin/banner-editor/index': 'banners',
  'packages/admin/knowledge/index': 'knowledge',
  'packages/admin/opportunities/index': 'opportunities',
  'packages/admin/opportunity-detail/index': 'opportunities',
  'packages/admin/opportunity-editor/index': 'opportunities',
  'packages/admin/opportunity-matching/index': 'opportunities',
  'packages/admin/user-content/index': 'user-content',
  'packages/admin/user-content-editor/index': 'user-content',
  'packages/admin/community-reports/index': 'community-reports',
  'packages/admin/growth-entries/index': 'growth-entries',
  'packages/admin/growth-transitions/index': 'growth-transitions',
  'packages/admin/growth-levels/index': 'growth-levels',
  'packages/admin/growth-benefits/index': 'growth-levels',
  'packages/admin/growth-rules/index': 'growth-levels',
  'packages/admin/tasks/index': 'tasks',
  'packages/admin/task-assignments/index': 'tasks',
  'packages/admin/task-completions/index': 'tasks',
  'packages/admin/badges/index': 'badges',
  'packages/admin/game/index': 'game',
  'packages/admin/blind-box/index': 'game',
  'packages/admin/branches/index': 'branches',
  'packages/admin/roles/index': 'roles',
  'packages/admin/exceptions/index': 'exceptions',
  'packages/admin/message-delivery-review/index': 'exceptions',
  'packages/admin/audit/index': 'audit',
}

const navigationTargets = new Set(
  adminWorkspaceGroups.flatMap(group => group.items.map(item => item.route)),
)

export function normalizeAdminWorkspaceRoute(route: string) {
  return route.trim().replace(/^\/+/, '').split(/[?#]/, 1)[0]
}

export function activeAdminWorkspaceItemKey(route: string) {
  return activeItemByRoute[normalizeAdminWorkspaceRoute(route)] || null
}

function canOpenItem(item: AdminWorkspaceNavItem, grants: AdminCapabilityGrant[]) {
  const hasGrant = (capability: AdminCapability) => grants.some(grant => (
    grant.capability === capability
    && (!item.platformOnly || (grant.scopeType === 'PLATFORM' && grant.scopeId === null))
  ))
  return item.requiresAll
    ? item.capabilities.every(hasGrant)
    : item.capabilities.some(hasGrant)
}

export function buildAdminWorkspaceNavigation(
  grants: AdminCapabilityGrant[],
  currentRoute: string,
): AdminWorkspaceNavGroupView[] {
  const activeKey = activeAdminWorkspaceItemKey(currentRoute)

  return adminWorkspaceGroups
    .map(group => ({
      key: group.key,
      label: group.label,
      items: group.items
        .filter(item => canOpenItem(item, grants))
        .map(item => ({ ...item, active: item.key === activeKey })),
    }))
    .filter(group => group.items.length > 0)
}

export function redirectToAdminWorkspace(
  currentRoute: string,
  targetRoute: string,
  navigator: AdminWorkspaceNavigator,
) {
  const current = normalizeAdminWorkspaceRoute(currentRoute)
  const target = normalizeAdminWorkspaceRoute(targetRoute)
  if (!navigationTargets.has(target) || current === target) {
    return false
  }
  navigator.redirectTo({ url: `/${target}` })
  return true
}
