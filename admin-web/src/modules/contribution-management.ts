import type { AdminRequest } from './admin-read-contracts'

export const contributionBehaviors = [
  { value: 'INVITE_GUEST', label: '邀请嘉宾' },
  { value: 'EVENT_CHECKIN', label: '活动签到' },
  { value: 'TASK_COMPLETED', label: '完成任务' },
  { value: 'TEAM_INVITE', label: '团队邀请嘉宾' },
  { value: 'OPPORTUNITY_REFERRAL', label: '引荐机会' },
  { value: 'OPPORTUNITY_COOPERATION', label: '合作成功' },
] as const
const contributionEvents: Record<string, string> = {
  INVITE_GUEST: 'event.guest_invited', EVENT_CHECKIN: 'event.checked_in', TASK_COMPLETED: 'task.completed',
  TEAM_INVITE: 'game.guest_invited', OPPORTUNITY_REFERRAL: 'referral.confirmed', OPPORTUNITY_COOPERATION: 'opportunity.cooperation.completed',
}
export function contributionManagement(request: AdminRequest) {
  return {
    reverse: (transactionNo: string, reversalValue: number, reason: string, idempotencyKey: string) => {
      if (!Number.isSafeInteger(reversalValue) || reversalValue < 1 || reversalValue > 1_000_000 || !reason.trim()) throw new Error('请填写正整数冲正值和原因')
      return request('mip.admin.contribution.transactions.reverse', { originalTransactionNo: transactionNo, reversalValue, reason: reason.trim(), idempotencyKey })
    },
  }
}

/** The contribution view and the reviewed growth export read the same append-only ledger. */
export function contributionExportFilters(filters: Record<string, string> = {}) {
  return {
    metric: 'CONTRIBUTION',
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.serverId ? { serverId: filters.serverId } : {}),
    ...(filters.behavior ? { sourceEventType: contributionEvents[filters.behavior] || filters.behavior } : {}),
    ...(filters.sinceTime ? { createdFrom: filters.sinceTime } : {}),
    ...(filters.untilTime ? { createdTo: filters.untilTime } : {}),
  }
}
