import type { AdminListQuery, AdminListRoute, AdminReadPage } from '../../modules/admin-read-pages'
import { labels } from '../../modules/admin-read-formatters'
import { demo } from '../../services/demo-data'

export function createDemoReadPage(route: AdminListRoute, query: AdminListQuery): AdminReadPage {
  const page = unfilteredDemoPage(route, query.filters?.section || '', query.filters?.type || '')
  const text = query.query.toLocaleLowerCase('zh-CN')
  const expectedStatus = query.status ? (labels[query.status] || query.status) : ''
  return {
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      rows: section.rows.filter(row => (!expectedStatus || String(row.state || row.status || '') === expectedStatus)
        && (!text || Object.values(row).some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(text)))),
    })),
  }
}

function unfilteredDemoPage(route: AdminListRoute, section: string, type: string): AdminReadPage {
  if (route === 'tasks') return {
    sections: [
      {
        title: '任务',
        rows: demo.tasks.map((item, index) => ({ ...item, detailId: `demo-task-${index + 1}` })),
        columns: columns([['name', '任务名称'], ['reward', '经验奖励'], ['assignment', '分配范围'], ['assigned', '已分配'], ['completed', '已完成'], ['endsAt', '截止时间'], ['updatedAt', '更新时间'], ['state', '状态']]),
        detailTarget: 'tasks',
      },
      {
        title: '近期完成记录',
        rows: demo.taskCompletions.map(item => ({ ...item })),
        columns: columns([['task', '任务'], ['member', '成员'], ['reward', '经验奖励'], ['completedAt', '完成时间'], ['state', '结果']]),
        detailTarget: null,
      },
    ],
    nextCursor: null,
  }
  if (route === 'permissions') return {
    sections: [{
      title: '运营成员',
      rows: demo.roles.map(item => ({ name: item.name, role: item.capabilities, scope: item.scope, grantedAt: '—', state: '启用' })),
      columns: columns([['name', '姓名'], ['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间'], ['state', '状态']]),
    }], nextCursor: null,
  }
  if (route === 'messages') return {
    sections: [
      {
        title: '消息活动',
        rows: demo.messages.map((item, index) => ({ ...item, detailId: `demo-message-${index + 1}`, scope: item.audience, state: item.status })),
        columns: columns([['title', '消息标题'], ['audience', '发送范围'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
      },
      {
        title: '消息模板',
        rows: [],
        columns: columns([['name', '模板名称'], ['title', '消息标题'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
      },
    ], nextCursor: null,
  }
  if (route === 'knowledge') return {
    sections: [{
      title: '知识内容',
      rows: demo.knowledge.map((item, index) => ({ ...item, detailId: `demo-knowledge-${index + 1}`, category: '运营规范', author: '运营团队', access: '会员可见', state: item.status })),
      columns: columns([['title', '文档标题'], ['type', '内容类型'], ['category', '分类'], ['author', '作者'], ['access', '访问范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }], nextCursor: null,
  }
  if (route === 'banners') return empty([
    { title: 'Banner', columns: columns([['image', '图片'], ['title', '管理名称'], ['target', '跳转目标'], ['order', '顺序'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: 'banners' },
  ])
  if (route === 'game') return empty([
    { title: '赛季', columns: columns([['name', '赛季'], ['period', '周期'], ['rules', '规则说明'], ['version', '版本'], ['state', '状态']]), detailTarget: 'gameSeasons' },
    { title: '战队', columns: columns([['name', '战队'], ['season', '赛季'], ['members', '成员'], ['state', '状态']]), detailTarget: 'gameTeams' },
    { title: '盲盒目录', columns: columns([['name', '目录'], ['cost', '抽取消耗'], ['cards', '卡片数'], ['stock', '剩余库存'], ['version', '版本'], ['state', '状态']]), detailTarget: 'gameCatalogs' },
  ])
  if (route === 'opportunities') return empty([
    // MIW-127：机会分区列与服务端 loadOpportunities 的 7 列设计稿口径一致（演示模式暂无机会行）。
    { title: '机会', columns: columns([['title', '项目名称'], ['owner', '发布人'], ['value', '价值金额（万元）'], ['city', '主营城市'], ['referrals', '想引荐数'], ['state', '状态'], ['publishedAt', '发布时间']]), detailTarget: 'opportunities' },
    { title: '用户内容', columns: columns([['title', '标题'], ['author', '作者'], ['type', '类型'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: 'userContent' },
  ])
  if (route === 'growth') {
    // MIW-129：成长体系四页共用 demo 装配，分区列与服务端 loadGrowth 保持一致。
    const sections: AdminReadPage['sections'] = [
      { title: '等级', rows: demo.growth.levels.map(item => ({ ...item })), columns: columns([['levelKey', '等级'], ['name', '名称'], ['threshold', '经验值门槛'], ['benefitCount', '权益数'], ['users', '用户数'], ['state', '状态']]), detailTarget: null },
      { title: '等级变更', rows: demo.growth.transitions.map(item => ({ ...item })), columns: columns([['user', '用户'], ['direction', '等级变化'], ['experience', '经验变化'], ['source', '来源事件'], ['createdAt', '时间']]), detailTarget: null },
      { title: '经验值流水', rows: demo.growth.entries.map(item => ({ ...item })), columns: columns([['entryNo', '流水号'], ['playerId', '玩家 ID'], ['source', '来源'], ['delta', '变动值'], ['before', '变动前'], ['after', '变动后'], ['createdAt', '时间']]), detailTarget: null },
      { title: '成长规则', rows: demo.growth.rules.map(item => ({ ...item })), columns: columns([['name', '规则'], ['metric', '指标'], ['delta', '增量'], ['dailyLimit', '每日上限'], ['source', '来源事件'], ['scope', '作用范围'], ['effective', '生效区间'], ['state', '状态']]), detailTarget: null },
      { title: '勋章目录', rows: demo.growth.badges.map(item => ({ ...item })), columns: columns([['name', '勋章'], ['description', '说明'], ['shape', '图形'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
      { title: '勋章获得记录', rows: demo.growth.awards.map(item => ({ ...item })), columns: columns([['user', '用户'], ['badge', '勋章'], ['reason', '原因'], ['awardedAt', '获得时间'], ['equipped', '佩戴'], ['state', '状态']]), detailTarget: null },
      { title: '贡献值规则', rows: demo.growth.contributionRules.map(item => ({ ...item })), columns: columns([['behavior', '行为'], ['rewardExp', '贡献奖励'], ['rewardLimit', '上限'], ['scope', '范围'], ['effective', '生效期'], ['state', '状态']]), detailTarget: null },
      { title: '贡献值流水', rows: demo.growth.contributionTransactions.map(item => ({ ...item })), columns: columns([['txnNo', '流水号'], ['user', '用户'], ['behavior', '行为'], ['delta', '变动值'], ['related', '关联业务'], ['createdAt', '时间']]), detailTarget: null },
      { title: '权益流水', rows: demo.growth.entitlements.map(item => ({ ...item })), columns: columns([['entitlementNo', '权益流水号'], ['user', '用户'], ['nickname', '昵称'], ['type', '权益类型'], ['content', '权益内容'], ['order', '关联订单号'], ['grantor', '发放人'], ['grantedAt', '发放时间']]), detailTarget: null },
      // MIW-27 第二轮：入会审核队列演示数据。行内「审核/复议」打开与真实队列相同的决策弹窗，
      // 演示模式不会提交写操作；行形态（列、链版本预填）与服务端 loadGrowth 保持一致。
      {
        title: '入会审核',
        rows: demo.membershipApprovals.map(item => ({
          id: item.id,
          user: item.user,
          playerNumber: item.playerNumber,
          plan: item.plan,
          amount: item.amount,
          paidAt: item.paidAt,
          requestedAt: item.requestedAt,
          state: item.state,
          decision: item.decision || '—',
          rowActions: [{
            action: 'mip.admin.membershipApprovals.decide' as const,
            label: item.status === 'PENDING' ? '审核' : '复议',
            targetId: item.targetId,
            values: { expectedChainVersion: item.chainVersion },
            allowedCapabilities: ['memberships.adjust'],
          }],
        })),
        columns: columns([['user', '用户'], ['playerNumber', '玩家号'], ['plan', '方案'], ['amount', '金额'], ['paidAt', '支付时间'], ['requestedAt', '申请时间'], ['state', '状态'], ['decision', '审核结论']]),
        detailTarget: null,
      },
    ]
    const bySection: Record<string, string> = {
      levels: '等级', transitions: '等级变更', badges: '勋章目录', awards: '勋章获得记录',
      entries: '经验值流水', rules: '成长规则',
      contributionRules: '贡献值规则', contributionTransactions: '贡献值流水',
      entitlements: '权益流水', membershipApprovals: '入会审核',
    }
    // 四个页面都会固定分区；无分区调用保留一页一份的紧凑概览，便于演示模式总览。
    const overviewTitles = ['等级', '经验值流水', '贡献值流水', '权益流水']
    return {
      sections: sections.filter(item => section ? item.title === bySection[section] : overviewTitles.includes(item.title || '')),
      nextCursor: null,
    }
  }
  if (route === 'operations') return empty([
    { title: '公告', columns: columns([['title', '标题'], ['scope', '范围'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '社区举报', columns: columns([['title', '举报内容'], ['reporter', '举报人'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '运营异常', columns: columns([['title', '异常'], ['resource', '资源'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
    { title: '运营待办', columns: columns([['title', '待办'], ['owner', '负责人'], ['updatedAt', '更新时间'], ['state', '状态']]), detailTarget: null },
  ])
  if (route === 'auditLogs') {
    // MIW-131：登录记录演示数据按 type=LOGIN 视图装配，列与真实装配一致。
    if (type === 'LOGIN') return {
      sections: [{
        title: '登录记录',
        rows: demo.auditLoginRecords.map((item, index) => ({
          detailId: `demo-audit-login-${index + 1}`,
          account: item.loginAccount,
          createdAt: item.createdAt,
          result: item.result === 'FAILURE' ? '失败' : '成功',
          ip: item.ip,
          device: item.device,
          failureReason: item.failureReason || '—',
        })),
        columns: columns([['account', '登录账号'], ['createdAt', '时间'], ['result', '结果'], ['ip', 'IP'], ['device', '设备'], ['failureReason', '失败原因']]),
      }],
      nextCursor: null,
    }
    return empty([{ title: '操作审计', columns: columns([['actor', '操作者'], ['action', '操作'], ['resource', '模块'], ['createdAt', '时间']]), detailTarget: null }])
  }
  return empty([{ columns: columns([['title', '记录']]), detailTarget: null }])
}

function empty(sections: Array<{ title?: string; columns: Array<{ key: string; label: string }>; detailTarget: AdminListSectionDetailTarget }>): AdminReadPage {
  return { sections: sections.map(section => ({ ...section, rows: [] })), nextCursor: null }
}

type AdminListSectionDetailTarget = 'tasks' | 'banners' | 'gameSeasons' | 'gameTeams' | 'gameCatalogs' | 'opportunities' | 'userContent' | null

function columns(values: Array<[string, string]>) {
  return values.map(([key, label]) => ({ key, label }))
}
