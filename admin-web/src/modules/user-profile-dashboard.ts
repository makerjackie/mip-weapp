import { record } from './admin-read-formatters.ts'

export interface UserDashboardMetric { key: string; label: string; value: string; description: string }
const count = (value: unknown, unit = '') => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toLocaleString('zh-CN')}${unit}` : '—'

/** Counts come from the server. Missing/failed aggregates must never look like real zeroes. */
export function userDashboardMetrics(payload: unknown): UserDashboardMetric[] {
  const user = record(payload), facts = record(user.influence), counts = record(user.counts)
  const fact = (key: string, unit: string) => count(facts.loadFailed ? null : facts[key], unit)
  const business = (key: string) => count(counts.loadFailed ? null : counts[key])
  return [
    { key: 'invitations', label: '邀请嘉宾数', value: fact('guestCount', ' 人'), description: '服务端按邀请和活动参与事实去重。' },
    { key: 'interactions', label: '互动用户数', value: fact('interactiveUserCount', ' 人'), description: '有效互动的去重人数；缺少已确认口径时不推算。' },
    { key: 'outgoing', label: '我的心动数', value: fact('outgoingHeartCount', ' 次'), description: '当前有效的主动活动心动票数，已撤销票不计入。' },
    { key: 'incoming', label: '对我心动数', value: fact('incomingHeartCount', ' 次'), description: '当前有效的收到活动心动票数，档案兴趣独立统计。' },
    { key: 'visits', label: '主页访客', value: `${fact('visitCount', ' 次')} / ${fact('visitorCount', ' 人')}`, description: '有效可见用户的访问次数与去重人数。' },
    { key: 'events', label: '活动参与', value: `报名 ${business('registrations')} / 签到 ${business('attended')}`, description: '报名记录数与当前已签到记录数。' },
    { key: 'publishes', label: '发布数', value: `${business('opportunities')} 个`, description: '当前未归档的机会数量。' },
    { key: 'referrals', label: '想引荐数', value: fact('referralCount', ' 次'), description: '本人发起的引荐意向记录累计。' },
  ]
}

export function userAccountStatus(value: unknown) {
  return value === 'ACTIVE' ? '正常' : value === 'BLOCKED' ? '已冻结' : value === 'CLOSED' ? '已注销' : '—'
}
