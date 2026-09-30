import type { AdminOverviewMetric } from './overview-model'

// Presentation groups only. Counts, units, scope and comparisons remain server facts.
const groups = [
  { key: 'people', title: '用户与访问', labels: ['新增用户', '已完善档案', '30 日互动玩家', '访客次数', '访客人数'] },
  { key: 'membership', title: '会籍与续费', labels: ['首次会籍购买', '首次续费', '再次续费', '会籍实付金额'] },
  { key: 'events', title: '活动与收入', labels: ['活动缴费订单', '活动实付金额', '活动退款金额', '活动净收入'] },
  { key: 'opportunities', title: '机会与内容', labels: ['机会总数', '招募中机会', '有效引荐', '公开合作卡', '公开案例'] },
  { key: 'tasks', title: '任务', labels: ['已发布任务', '成功完成任务', '任务发放经验'] },
] as const

export function groupOverviewMetrics(metrics: AdminOverviewMetric[]) {
  const remaining = metrics.slice(4)
  const assigned = new Set<string>()
  const result = groups.map(group => ({ key: String(group.key), title: String(group.title), metrics: remaining.filter(metric => {
    if (!(group.labels as readonly string[]).includes(metric.label)) return false
    assigned.add(metric.label)
    return true
  }) })).filter(group => group.metrics.length)
  const extra = remaining.filter(metric => !assigned.has(metric.label))
  if (extra.length) result.push({ key: 'other', title: '其他指标', metrics: extra })
  return result
}
