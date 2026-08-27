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
export type HtmlEscaper = (value: unknown) => string

export function createMutationDefinition(
  action: AdminMutationAction,
  targetId: string,
  readDetailField: DetailFieldReader,
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
  if (action === 'mip.admin.communications.publishEventReminder') return {
    action, targetId, title: '发布活动提醒', description: '为当前活动生成提醒投递任务。只有已发布活动可以执行此操作。',
    values: { expectedVersion: version, sendWechatReminder: true },
  }
  return {
    action, targetId, title: '提交退款', description: '提交当前订单的退款申请。金额和退款状态由服务端订单与支付流水决定。',
    values: { reason: '' },
  }
}

export function renderMutationDialog(state: MutationState, escapeHtml: HtmlEscaper) {
  const disabled = state.busy || Boolean(state.error)
  const values = state.values
  const field = (name: string) => escapeHtml(values[name] ?? '')
  let fields = ''
  if (state.action === 'mip.admin.memberships.grant') {
    fields = `<label>会员时长<select name="durationMonths" ${disabled ? 'disabled' : ''}><option value="1" ${values.durationMonths === '1' ? 'selected' : ''}>1 个月</option><option value="3" ${values.durationMonths === '3' ? 'selected' : ''}>3 个月</option><option value="6" ${values.durationMonths === '6' ? 'selected' : ''}>6 个月</option><option value="12" ${values.durationMonths === '12' ? 'selected' : ''}>12 个月</option></select></label><label class="mutation-wide">调整原因<textarea name="reason" rows="3" maxlength="300" required ${disabled ? 'disabled' : ''}>${field('reason')}</textarea></label>`
  }
  else if (state.action === 'mip.admin.communications.publishEventReminder') {
    fields = `<label class="mutation-checkbox"><input name="sendWechatReminder" type="checkbox" ${values.sendWechatReminder ? 'checked' : ''} ${disabled ? 'disabled' : ''} />同时生成微信提醒任务</label>`
  }
  else if (state.action === 'mip.admin.refunds.submit') {
    fields = '<label class="mutation-wide">退款原因<textarea name="reason" rows="3" maxlength="300" required ' + `${disabled ? 'disabled' : ''}` + `>${field('reason')}</textarea></label>`
  }
  const error = state.error
    ? `<div class="mutation-error" role="alert">${escapeHtml(state.error)}<small>请求结果不确定时，请先核对服务端记录；再次提交会按同一次操作处理。</small></div>`
    : ''
  const buttonLabel = state.busy ? '提交中' : state.error ? '手动重试' : '确认提交'
  return `<div class="mutation-backdrop" id="mutation-backdrop"><section class="mutation-dialog" role="dialog" aria-modal="true" aria-labelledby="mutation-title"><button id="mutation-close-button" class="login-close" aria-label="关闭" ${state.busy ? 'disabled' : ''}>×</button><span class="login-kicker">操作确认</span><h2 id="mutation-title">${escapeHtml(state.title)}</h2><p>${escapeHtml(state.description)}</p><form id="mutation-form"><div class="mutation-fields">${fields}</div>${error}<div class="mutation-actions"><button type="button" class="outline-button" id="mutation-cancel-button" ${state.busy ? 'disabled' : ''}>取消</button><button type="submit" class="primary-button" ${state.busy ? 'disabled' : ''}>${buttonLabel}</button></div></form></section></div>`
}

export function readMutationValues(
  data: FormData,
  previous: MutationValues,
  action: AdminMutationAction,
): MutationValues {
  const values: MutationValues = {}
  for (const [key, value] of data.entries()) values[key] = typeof value === 'string' ? value.trim() : String(value)
  for (const [key, value] of Object.entries(previous)) {
    if (!(key in values)) values[key] = value
  }
  if (action === 'mip.admin.communications.publishEventReminder') values.sendWechatReminder = data.get('sendWechatReminder') === 'on'
  return values
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
  if (state.action === 'mip.admin.communications.publishEventReminder') {
    const expectedVersion = Number(values.expectedVersion)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null
    return { eventId: state.targetId, expectedVersion, sendWechatReminder: values.sendWechatReminder === true }
  }
  if (!values.reason) return null
  return { orderId: state.targetId, reason: String(values.reason) }
}

export function mutationSummary(action: AdminMutationAction, values: MutationValues) {
  if (action === 'mip.admin.memberships.grant') return `${values.durationMonths} 个月会员权益，原因：${values.reason}`
  if (action === 'mip.admin.events.clone') return '根据当前活动创建草稿'
  if (action === 'mip.admin.communications.publishEventReminder') return values.sendWechatReminder === true ? '同时生成微信提醒任务' : '仅生成站内提醒任务'
  return `退款原因：${values.reason}`
}
