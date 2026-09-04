import type { AdminRequestInput } from '../domain/contracts'
import type { AdminMutationAction, AdminMutationIntent } from './admin-mutations'

export type MutationValues = Record<string, string | boolean>

export type MutationState = {
  action: AdminMutationAction
  targetId: string
  title: string
  description: string
  intent: AdminMutationIntent
  values: MutationValues
  error: string
  busy: boolean
}

export type MutationDefinition = Omit<MutationState, 'intent' | 'error' | 'busy'>
export type DetailFieldReader = (sectionTitle: string, label: string) => string

export function createMutationDefinition(
  action: AdminMutationAction,
  targetId: string,
  readDetailField: DetailFieldReader,
  targetStatus?: 'PUBLISHED' | 'UNPUBLISHED',
): MutationDefinition {
  const version = readDetailField('活动信息', '版本') || '1'
  const membershipChainVersion = readDetailField('会员权益', '会员链版本') || '1'
  if (action === 'mip.admin.memberships.grant') return {
    action, targetId, title: '补录会员', description: '为该用户追加有效付费权益。提交前请确认会员时长和调整原因。',
    values: { durationMonths: '12', expectedChainVersion: membershipChainVersion, reason: '' },
  }
  if (action === 'mip.admin.events.clone') return {
    action, targetId, title: '克隆活动', description: '根据当前活动创建一份新的草稿活动。提交后由服务端重新校验权限和活动版本。',
    values: { expectedVersion: version },
  }
  if (action === 'mip.admin.events.changeStatus') {
    const status = targetStatus || 'PUBLISHED'
    return {
      action,
      targetId,
      title: status === 'PUBLISHED' ? '发布活动' : '下架活动',
      description: status === 'PUBLISHED'
        ? '发布前由服务端校验内容安全、活动时间和当前版本。'
        : '下架后活动不再接受新的公开报名，历史报名和订单事实会保留。',
      values: { expectedVersion: version, status },
    }
  }
  if (action === 'mip.admin.events.archive') return {
    action,
    targetId,
    title: '归档活动',
    description: '仅可归档没有报名、订单、签到或相册记录的草稿活动。提交后活动历史仍会保留。',
    values: { expectedVersion: version, reason: '' },
  }
  if (action === 'mip.admin.communications.publishEventReminder') return {
    action, targetId, title: '发布活动提醒', description: '为当前活动生成提醒投递任务。只有已发布活动可以执行此操作。',
    values: { expectedVersion: version, sendWechatReminder: true },
  }
  return {
    action, targetId, title: '提交退款', description: '提交当前订单的退款申请。金额和退款状态由服务端订单与支付流水决定。',
    values: { reason: '' },
  }
}

export function mutationInput(state: MutationState, values: MutationValues): AdminRequestInput | null {
  if (state.action === 'mip.admin.memberships.grant') {
    const durationMonths = Number(values.durationMonths)
    const expectedChainVersion = Number(values.expectedChainVersion)
    if (![1, 3, 6, 12].includes(durationMonths) || !Number.isSafeInteger(expectedChainVersion) || expectedChainVersion < 1 || !values.reason) return null
    return { userId: state.targetId, durationMonths, expectedChainVersion, reason: String(values.reason) }
  }
  if (state.action === 'mip.admin.events.clone') {
    const expectedVersion = Number(values.expectedVersion)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null
    return { sourceEventId: state.targetId, expectedVersion }
  }
  if (state.action === 'mip.admin.events.changeStatus') {
    const expectedVersion = Number(values.expectedVersion)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !['PUBLISHED', 'UNPUBLISHED'].includes(String(values.status))) return null
    return { eventId: state.targetId, expectedVersion, status: String(values.status) }
  }
  if (state.action === 'mip.admin.events.archive') {
    const expectedVersion = Number(values.expectedVersion)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !values.reason) return null
    return { eventId: state.targetId, expectedVersion, reason: String(values.reason) }
  }
  if (state.action === 'mip.admin.communications.publishEventReminder') {
    const expectedVersion = Number(values.expectedVersion)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null
    return { eventId: state.targetId, expectedVersion, sendWechatReminder: values.sendWechatReminder === true }
  }
  if (!values.reason) return null
  return { orderId: state.targetId, reason: String(values.reason) }
}
