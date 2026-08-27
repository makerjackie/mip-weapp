export const demo = {
  dashboard: {
    users: 1284, activeMembers: 436, upcomingEvents: 12, pendingOrders: 8,
    activity: [
      { title: 'MIP 早会｜城市增长与资源协作', meta: '2030-03-14 10:00 · 深圳福田', status: '已发布' },
      { title: 'MIP 早会｜品牌与产品实践', meta: '2030-03-21 10:00 · 深圳福田', status: '报名中' },
      { title: 'MIP 早会｜团队执行与项目复盘', meta: '2030-03-28 10:00 · 深圳福田', status: '草稿' },
    ],
  },
  users: [
    { id: 'USR-1001', name: '林晓', company: '远岸品牌咨询', role: '狗策划', phone: '188****3403', status: '有效会员', branch: '深圳福田' },
    { id: 'USR-1002', name: '周宁', company: '新域投资', role: '暴发户', phone: '139****2811', status: '嘉宾', branch: '香港' },
    { id: 'USR-1003', name: '陈默', company: '木棉设计', role: '死美工', phone: '186****9077', status: '有效会员', branch: '中山' },
  ],
  events: [
    { id: 'EVT-20300314', title: 'MIP 早会｜城市增长与资源协作', time: '2030-03-14 10:00–12:00', location: '深圳市福田区福华三路 118 号', registrations: 36, status: '已发布' },
    { id: 'EVT-20300321', title: 'MIP 早会｜品牌与产品实践', time: '2030-03-21 10:00–12:00', location: '深圳市福田区深南大道 6008 号', registrations: 24, status: '报名中' },
    { id: 'EVT-20300328', title: 'MIP 早会｜团队执行与项目复盘', time: '2030-03-28 10:00–12:00', location: '深圳市福田区金田路 3037 号', registrations: 18, status: '草稿' },
  ],
  orders: [
    { id: 'ORD-20300018', user: '林晓', type: '年度会员', amount: '¥6,000.00', status: '已支付', createdAt: '2030-02-16 14:20' },
    { id: 'ORD-20300019', user: '陈默', type: 'MIP 早会门票', amount: '¥199.00', status: '待确认', createdAt: '2030-02-18 09:12' },
    { id: 'ORD-20300020', user: '周宁', type: '活动门票', amount: '¥299.00', status: '已关闭', createdAt: '2030-02-18 08:48' },
  ],
  roles: [
    { name: '平台管理员', members: 2, scope: '平台', capabilities: '全部运营权限' },
    { name: '城市运营成员', members: 8, scope: '分会', capabilities: '活动、用户、消息' },
    { name: '内容运营', members: 4, scope: '平台', capabilities: '知识库、消息' },
  ],
  messages: [
    { title: '活动报名确认提醒', audience: '已报名用户', status: '已发布', updatedAt: '2030-02-18 10:30' },
    { title: '会员权益到期提醒', audience: '会员用户', status: '定时中', updatedAt: '2030-02-17 16:00' },
  ],
  knowledge: [
    { title: 'MIP 城市分会运营手册', type: '运营文档', status: '已发布', updatedAt: '2030-02-15' },
    { title: '活动主持人与签到规范', type: '流程文档', status: '草稿', updatedAt: '2030-02-12' },
  ],
} as const
