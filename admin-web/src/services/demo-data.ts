export const demo = {
  dashboard: {
    currentPlayers: 1286, firstYearRenewals: 328, newPlayersThisMonth: 86, paidAmountCents: 12860000,
    // MIW-123：按月玩家趋势演示数据，生产契约 playerTrend 字段待服务端联调。
    playerTrendMonths: [
      { month: '2029-03', newPlayers: 42, firstRenewal: 18, nextRenewal: 6 },
      { month: '2029-04', newPlayers: 48, firstRenewal: 22, nextRenewal: 7 },
      { month: '2029-05', newPlayers: 45, firstRenewal: 20, nextRenewal: 8 },
      { month: '2029-06', newPlayers: 52, firstRenewal: 26, nextRenewal: 9 },
      { month: '2029-07', newPlayers: 61, firstRenewal: 31, nextRenewal: 11 },
      { month: '2029-08', newPlayers: 58, firstRenewal: 28, nextRenewal: 10 },
      { month: '2029-09', newPlayers: 67, firstRenewal: 34, nextRenewal: 12 },
      { month: '2029-10', newPlayers: 72, firstRenewal: 37, nextRenewal: 13 },
      { month: '2029-11', newPlayers: 69, firstRenewal: 35, nextRenewal: 12 },
      { month: '2029-12', newPlayers: 78, firstRenewal: 41, nextRenewal: 14 },
      { month: '2030-01', newPlayers: 74, firstRenewal: 38, nextRenewal: 13 },
      { month: '2030-02', newPlayers: 86, firstRenewal: 44, nextRenewal: 15 },
    ],
    activity: [
      { title: 'MIP 早会｜城市增长与资源协作', meta: '2030-03-14 10:00 · 深圳福田', status: '已发布' },
      { title: 'MIP 早会｜品牌与产品实践', meta: '2030-03-21 10:00 · 深圳福田', status: '报名中' },
      { title: 'MIP 早会｜团队执行与项目复盘', meta: '2030-03-28 10:00 · 深圳福田', status: '草稿' },
    ],
  },
  // MIW-124：用户演示数据按生产列表口径（当前角色/玩家权益状态分档）；USR-1004 为普通用户，
  // 用于验证「身份=普通用户」筛选链路。非玩家所属服务器按口径显示「—」。
  users: [
    { id: 'USR-1001', name: '林晓', phone: '188****3403', role: '玩家', industry: '品牌咨询', profession: '策略策划', level: 'Lv.8', contribution: '3.28K', playerStatus: '生效中', createdAt: '2029-06-12 10:24', expiresAt: '2030-05-18 23:59', branch: '深圳福田' },
    { id: 'USR-1002', name: '周宁', phone: '139****2811', role: '嘉宾', industry: '投资', profession: '资本合作', level: 'Lv.3', contribution: '620', playerStatus: '—', createdAt: '2029-11-02 18:40', expiresAt: '—', branch: '—' },
    { id: 'USR-1003', name: '陈默', phone: '186****9077', role: '玩家', industry: '设计', profession: '视觉设计', level: 'Lv.5', contribution: '1.6K', playerStatus: '本月到期', createdAt: '2030-01-20 09:05', expiresAt: '2030-03-02 23:59', branch: '中山' },
    { id: 'USR-1004', name: '苏蔓', phone: '137****5520', role: '普通用户', industry: '消费品牌', profession: '品牌主理人', level: 'Lv.1', contribution: '80', playerStatus: '—', createdAt: '2030-02-14 20:12', expiresAt: '—', branch: '—' },
  ],
  events: [
    { id: 'EVT-20300314', title: 'MIP 早会｜城市增长与资源协作', time: '2030-03-14 10:00–12:00', location: '深圳市福田区福华三路 118 号', registrations: 36, status: '已发布' },
    { id: 'EVT-20300321', title: 'MIP 早会｜品牌与产品实践', time: '2030-03-21 10:00–12:00', location: '深圳市福田区深南大道 6008 号', registrations: 24, status: '报名中' },
    { id: 'EVT-20300328', title: 'MIP 早会｜团队执行与项目复盘', time: '2030-03-28 10:00–12:00', location: '深圳市福田区金田路 3037 号', registrations: 18, status: '草稿' },
  ],
  // MIW-126：活动设置页的演示标签目录，名称与 RemoteCatalogSelect 的演示标签同口径。
  eventTags: [
    { id: 'CAT-TAG-1', kind: 'TAG', name: '早会', description: '早会类活动标签', status: 'ACTIVE', version: 3, sortOrder: 10, usageCount: 12 },
    { id: 'CAT-TAG-2', kind: 'TAG', name: '集会', description: '', status: 'ACTIVE', version: 1, sortOrder: 20, usageCount: 4 },
    { id: 'CAT-TAG-3', kind: 'TAG', name: '沙龙', description: '', status: 'INACTIVE', version: 2, sortOrder: 30, usageCount: 0 },
  ],
  // 支付/完成时间口径：会费订单完成时间=支付成功时间；活动订单完成时间=活动开始时间（2030-03-14 早会）。
  orders: [
    { id: 'ORD-20300018', user: '林晓', type: '年度会员', amount: '¥6,000.00', status: '已支付', paidAt: '2030-02-16 14:25', completedAt: '2030-02-16 14:25', createdAt: '2030-02-16 14:20' },
    { id: 'ORD-20300019', user: '陈默', type: 'MIP 早会门票', amount: '¥199.00', status: '待确认', paidAt: '', completedAt: '2030-03-14 10:00', createdAt: '2030-02-18 09:12' },
    { id: 'ORD-20300020', user: '周宁', type: '活动门票', amount: '¥299.00', status: '已关闭', paidAt: '', completedAt: '', createdAt: '2030-02-18 08:48' },
  ],
  tasks: [
    { name: 'MIP 早会复盘', reward: '30', assignment: '指定成员', assigned: '24', completed: '18', endsAt: '2030-03-31 18:00', updatedAt: '2030-03-22 11:20', state: '已发布' },
    { name: '会员合作机会跟进', reward: '50', assignment: '全部成员', assigned: '436', completed: '67', endsAt: '2030-04-30 18:00', updatedAt: '2030-03-21 16:45', state: '草稿' },
  ],
  taskCompletions: [
    { task: 'MIP 早会复盘', member: '林晓', reward: '30', completedAt: '2030-03-22 10:36', state: '成功' },
    { task: 'MIP 早会复盘', member: '陈默', reward: '30', completedAt: '2030-03-21 17:08', state: '成功' },
  ],
  // MIW-130：NPC任务页演示数据，按服务端任务完成记录 DTO 形态呈现提交与审批结构（待联调）。
  // id 使用合法 UUID 以复用真实行操作；演示模式不会提交写操作。真实数据走 mip.admin.tasks.completions.list。
  taskApprovals: [
    {
      id: '30000000-0000-4000-8000-000000000011', taskName: 'MIP 早会复盘', nickname: '林晓', starLevel: 3,
      submissionStatus: 'pending_review', rewardExperience: 30, completedAt: '2030-03-22T10:36:00.000Z',
      attachment: { url: '', contentType: 'image/jpeg', bytes: 204800 }, rewardResult: {}, canReview: true,
    },
    {
      id: '30000000-0000-4000-8000-000000000012', taskName: '会员合作机会跟进', nickname: '陈默', starLevel: 4,
      submissionStatus: 'approved', reviewedBy: '30000000-0000-4000-8000-000000000099', reviewedByName: '笨笨老大',
      reviewedAt: '2030-03-21T18:00:00.000Z', rewardExperience: 50, completedAt: '2030-03-21T17:08:00.000Z',
      attachment: { url: '', contentType: 'image/png', bytes: 102400 },
      rewardResult: { experience: { amount: 50, status: 'SUCCESS' } },
    },
    {
      id: '30000000-0000-4000-8000-000000000013', taskName: 'MIP 早会复盘', nickname: '周宁', starLevel: 2,
      submissionStatus: 'reward_failed', reviewedBy: '30000000-0000-4000-8000-000000000099', reviewedByName: '笨笨老大',
      reviewedAt: '2030-03-20T09:40:00.000Z', rewardExperience: 30, completedAt: '2030-03-20T09:12:00.000Z',
      rewardResult: { error: '奖励发放失败，可重试' }, retryLog: [{ at: '2030-03-20T10:00:00.000Z' }], canReview: true,
    },
  ],
  // MIW-27 第二轮：入会审核队列演示数据。targetId 对应上方演示用户，decision 为空表示待审核。
  membershipApprovals: [
    { id: 'MAP-20300021', targetId: 'USR-1002', user: '周宁', playerNumber: 'M000000002', plan: '年度会员', amount: '¥6,600.00', paidAt: '2030-03-20 15:42', requestedAt: '2030-03-20 15:43', state: '待处理', status: 'PENDING', chainVersion: 3, decision: '' },
    { id: 'MAP-20300022', targetId: 'USR-1003', user: '陈默', playerNumber: 'M000000003', plan: '季度会员', amount: '¥1,880.00', paidAt: '2030-03-18 11:05', requestedAt: '2030-03-18 11:06', state: '已驳回', status: 'REJECTED', chainVersion: 5, decision: '驳回：线下支付未确认' },
  ],
  // MIW-129：成长体系四页演示数据。行键与 loadGrowth 装配列一致；关联业务跳转
  // 仅覆盖已确认语义（任务/机会），活动签到类只展示编号（待联调）。
  growth: {
    levels: [
      { levelKey: 'Lv.1', name: '启程', threshold: '0', benefitCount: '1', users: '86', state: '启用' },
      { levelKey: 'Lv.5', name: '同行', threshold: '5000', benefitCount: '3', users: '42', state: '启用' },
      { levelKey: 'Lv.8', name: '主理', threshold: '20000', benefitCount: '5', users: '12', state: '草稿' },
    ],
    transitions: [
      { user: '林晓', direction: 'Lv.5 同行 → Lv.8 主理', experience: '19800 → 20100', source: '活动签到', createdAt: '2030-03-20 10:30' },
    ],
    badges: [
      { name: '活动参与', description: '完成活动参与记录', shape: '圆形', updatedAt: '2030-03-01 09:00', state: '启用' },
      { name: '荣誉志愿者', description: '年度志愿服务', shape: '六边形', updatedAt: '2030-02-11 16:20', state: '启用' },
    ],
    awards: [
      { user: '林晓', badge: '活动参与', reason: '完成个人资料', awardedAt: '2030-03-01 10:00', equipped: '开启', state: '启用' },
    ],
    entries: [
      { entryNo: 'GE-20300001', playerId: 'USR-1001', source: '活动签到', delta: '10', before: '19,790', after: '19,800', createdAt: '2030-03-20 10:30' },
      { entryNo: 'GE-20300002', playerId: 'USR-1003', source: '任务', delta: '30', before: '4,120', after: '4,150', createdAt: '2030-03-21 17:08' },
      { entryNo: 'GE-20300003', playerId: 'USR-1002', source: '人工冲正', delta: '-50', before: '1,050', after: '1,000', createdAt: '2030-03-22 09:15' },
    ],
    rules: [
      { name: '完成活动签到', metric: '经验值', delta: '10', dailyLimit: '20', source: '活动签到', scope: '平台', effective: '长期有效', state: '启用' },
      { name: '完善资料', metric: '经验值', delta: '50', dailyLimit: '—', source: '其他业务记录', scope: '平台', effective: '长期有效', state: '启用' },
    ],
    contributionRules: [
      { behavior: '参加活动及签到', rewardExp: '2', rewardLimit: '每日最多 3', scope: '全部服务器', effective: '长期有效', state: '启用' },
      { behavior: '完成 NPC 任务', rewardExp: '5', rewardLimit: '—', scope: '深圳', effective: '2030-01-01 08:00 – 2030-12-31 23:59', state: '启用' },
    ],
    contributionTransactions: [
      { txnNo: 'CT-20300011', user: '林晓', behavior: '参加活动及签到', delta: '2', related: 'EVT-20300314', createdAt: '2030-03-14 10:35' },
      { txnNo: 'CT-20300012', user: '陈默', behavior: '完成 NPC 任务', delta: '5', related: '30000000-0000-4000-8000-000000000011', detailLinks: [{ route: 'taskCompletions', id: '30000000-0000-4000-8000-000000000011', label: '关联业务' }], createdAt: '2030-03-21 17:08' },
      { txnNo: 'CT-20300013', user: '周宁', behavior: '引荐项目机会', delta: '20', related: 'OPP-20300007', detailLinks: [{ route: 'opportunities', id: 'OPP-20300007', label: '关联业务' }], createdAt: '2030-03-19 15:00' },
    ],
    entitlements: [
      { entitlementNo: 'ENT-20300031', user: 'USR-1001', nickname: '林晓', type: '玩家会籍', content: '12 个月', order: 'MIP20300101001', grantor: '周宁', detailLinks: [{ route: 'users', id: 'USR-1001', label: '用户档案' }], grantedAt: '2030-01-01 08:00' },
      { entitlementNo: 'ENT-20300032', user: 'USR-1003', nickname: '陈默', type: '经验值', content: '手工调整 +100', order: '—', grantor: '笨笨老大', detailLinks: [{ route: 'users', id: 'USR-1003', label: '用户档案' }], grantedAt: '2030-03-05 14:20' },
    ],
  },
  roles: [
    { name: '平台管理员', members: 2, scope: '平台', capabilities: '全部运营权限' },
    { name: '服务器运营成员', members: 8, scope: '服务器', capabilities: '活动、用户、消息' },
    { name: '内容运营', members: 4, scope: '平台', capabilities: '知识库、消息' },
  ],
  messages: [
    { title: '活动报名确认提醒', audience: '已报名用户', status: '已发布', updatedAt: '2030-02-18 10:30' },
    { title: '会员权益到期提醒', audience: '会员用户', status: '定时中', updatedAt: '2030-02-17 16:00' },
  ],
  knowledge: [
    { title: 'MIP 服务器运营手册', type: '运营文档', status: '已发布', updatedAt: '2030-02-15' },
    { title: '活动主持人与签到规范', type: '流程文档', status: '草稿', updatedAt: '2030-02-12' },
  ],
  // MIW-131：登录记录演示数据。服务端登录审计事件（type=LOGIN）待联调，
  // 演示模式先按契约字段展示 2 成功 1 失败的最小样例。
  auditLoginRecords: [
    { loginAccount: 'admin', createdAt: '2030-03-20 09:12', result: 'SUCCESS', ip: '203.0.113.24', device: 'Chrome 138 · macOS', failureReason: '' },
    { loginAccount: 'ops.futian', createdAt: '2030-03-20 10:05', result: 'SUCCESS', ip: '198.51.100.7', device: 'Edge 136 · Windows', failureReason: '' },
    { loginAccount: 'ops.futian', createdAt: '2030-03-20 10:08', result: 'FAILURE', ip: '198.51.100.7', device: 'Edge 136 · Windows', failureReason: '密码错误' },
  ],
} as const
