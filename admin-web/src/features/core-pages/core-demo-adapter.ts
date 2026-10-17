import type {
  AdminListQuery,
  AdminReadPage,
  AdminTableRow,
} from '../../modules/admin-read-pages'
import { labels } from '../../modules/admin-read-formatters'
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
      { label: '当前玩家', value: demo.dashboard.currentPlayers.toLocaleString('zh-CN'), detail: '较上一周期 +12.6%', trend: 'up' },
      { label: '首年续费', value: demo.dashboard.firstYearRenewals.toLocaleString('zh-CN'), detail: '较上一周期 +8.4%', trend: 'up' },
      { label: '本月新增玩家', value: demo.dashboard.newPlayersThisMonth.toLocaleString('zh-CN'), detail: '较上一周期 +9.8%', trend: 'up' },
      { label: '缴费金额', value: `¥${(demo.dashboard.paidAmountCents / 100).toLocaleString('zh-CN')}`, detail: '较上一周期 -3.1%', trend: 'down' },
    ],
    playerTrend: { available: true, months: demo.dashboard.playerTrendMonths.map(month => ({ ...month })) },
    attention: [
      { label: '30 日内到期会员', value: '1', target: '/users' },
      { label: '待审核报名', value: '1', target: '/events' },
      { label: '待验收任务', value: '1', target: '/task-approval' },
      { label: '消息发送失败', value: '1', target: '/operations' },
    ],
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
        headline: item.company,
        identity: item.status,
        phone: item.phone,
        branch: item.branch,
        level: item.role,
        state: '启用',
      })),
      columns: [
        { key: 'name', label: '姓名' },
        { key: 'headline', label: '简介' },
        { key: 'identity', label: '身份' },
        { key: 'phone', label: '手机状态' },
        { key: 'branch', label: '所属服务器' },
        { key: 'level', label: '等级' },
        { key: 'state', label: '账号状态' },
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

function filterDemoRows(rows: AdminTableRow[], query: Pick<AdminListQuery, 'query' | 'status'>) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const expectedStatus = labels[query.status] || query.status
  return rows.filter((row) => {
    const values = Object.values(row).map(value => String(value))
    return (!keyword || values.some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      && (!expectedStatus || values.includes(expectedStatus))
  })
}
