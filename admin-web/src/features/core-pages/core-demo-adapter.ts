import type {
  AdminListQuery,
  AdminReadPage,
  AdminTableRow,
} from '../../modules/admin-read-pages'
import { label, labels, playerStatusFilterLabel } from '../../modules/admin-read-formatters'
import { demo } from '../../services/demo-data'
import type { AdminOverviewView } from './overview-model'

type DemoCoreRoute = 'users' | 'events' | 'orders'

export function createCoreDemoReadPage(route: DemoCoreRoute, query: AdminListQuery): AdminReadPage {
  const page = route === 'users'
    ? demoUsersPage()
    : route === 'events'
      ? demoEventsPage()
      : demoOrdersPage()
  return {
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      rows: filterDemoRows(section.rows, query),
    })),
  }
}

export function createCoreDemoOverview(): AdminOverviewView {
  return {
    period: '2030 年 2 月',
    asOf: '演示数据',
    metrics: [
      { label: '用户总数', value: demo.dashboard.users.toLocaleString('zh-CN'), detail: '演示数据' },
      { label: '有效会员', value: demo.dashboard.activeMembers.toLocaleString('zh-CN'), detail: '会员权益有效' },
      { label: '近期活动', value: demo.dashboard.upcomingEvents.toLocaleString('zh-CN'), detail: '未来 30 天' },
      { label: '待处理订单', value: demo.dashboard.pendingOrders.toLocaleString('zh-CN'), detail: '需要运营跟进' },
    ],
    playerTrend: { available: false, points: [] },
    attention: [{
      label: '待处理订单',
      value: demo.dashboard.pendingOrders.toLocaleString('zh-CN'),
      target: '/orders',
    }],
    activity: demo.dashboard.activity.map((item, index) => ({
      detailId: `demo-activity-${index + 1}`,
      title: item.title,
      meta: item.meta,
      state: item.status,
    })),
  }
}

function demoUsersPage(): AdminReadPage {
  return {
    sections: [{
      rows: demo.users.map(item => ({
        detailId: item.id,
        name: item.name,
        avatarUrl: '—',
        role: item.role,
        phone: item.phone,
        industry: item.industry,
        profession: item.profession,
        level: item.level,
        contribution: item.contribution,
        playerStatus: item.playerStatus,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        state: '启用',
      })),
      columns: [
        { key: 'avatarUrl', label: '头像' },
        { key: 'name', label: '昵称' },
        { key: 'phone', label: '手机号' },
        { key: 'role', label: '当前角色' },
        { key: 'industry', label: '行业' },
        { key: 'profession', label: '当前身份' },
        { key: 'level', label: '用户等级' },
        { key: 'contribution', label: '贡献值' },
        { key: 'playerStatus', label: '玩家权益状态' },
        { key: 'createdAt', label: '用户注册时间' },
        { key: 'expiresAt', label: '玩家到期时间' },
      ],
    }],
    nextCursor: null,
  }
}

function demoEventsPage(): AdminReadPage {
  return {
    sections: [{
      rows: demo.events.map(item => ({
        ...item,
        detailId: item.id,
        access: '会员权益',
        attended: '—',
        state: item.status,
      })),
      columns: [
        { key: 'title', label: '活动名称' },
        { key: 'time', label: '开始时间' },
        { key: 'location', label: '城市与服务器' },
        { key: 'access', label: '活动类型' },
        { key: 'registrations', label: '报名人数' },
        { key: 'attended', label: '签到人数' },
        { key: 'state', label: '状态' },
      ],
    }],
    nextCursor: null,
  }
}

function demoOrdersPage(): AdminReadPage {
  return {
    sections: [{
      rows: demo.orders.map(item => ({
        ...item,
        detailId: item.id,
        resource: item.type,
        state: item.status,
      })),
      columns: [
        { key: 'id', label: '订单号' },
        { key: 'user', label: '用户' },
        { key: 'type', label: '订单类型' },
        { key: 'resource', label: '订单内容' },
        { key: 'amount', label: '金额' },
        { key: 'createdAt', label: '创建时间' },
        { key: 'state', label: '状态' },
      ],
    }],
    nextCursor: null,
  }
}

function filterDemoRows(rows: AdminTableRow[], query: AdminListQuery) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const expectedStatus = labels[query.status] || query.status
  // MIW-124：身份筛选含「普通用户」（NORMAL），权益状态按到期分档标签匹配。
  const expectedRole = query.filters?.kind ? label(query.filters.kind) : ''
  const expectedPlayerStatus = playerStatusFilterLabel(query.filters?.playerLifecycle)
  return rows.filter((row) => {
    const values = Object.values(row).map(value => String(value))
    return (!keyword || values.some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      && (!expectedStatus || values.includes(expectedStatus))
      && (!expectedRole || row.role === expectedRole)
      && (!expectedPlayerStatus || row.playerStatus === expectedPlayerStatus)
  })
}
