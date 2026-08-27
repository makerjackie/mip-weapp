import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMutationIntent } from './admin-mutations.ts'
import {
  createMutationDefinition,
  mutationInput,
  mutationSummary,
  readMutationValues,
  renderMutationDialog,
  type MutationState,
} from './admin-mutation-ui.ts'

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

function state(action: MutationState['action'], values: Record<string, string | boolean>): MutationState {
  return {
    ...createMutationDefinition(action, 'resource-1', (section, label) => section === '活动信息' && label === '版本' ? '4' : section === '会员权益' && label === '会员链版本' ? '9' : ''),
    intent: createMutationIntent(action, values),
    values,
    error: '',
    busy: false,
  }
}

describe('admin mutation UI model', () => {
  it('derives server concurrency versions from the detail view', () => {
    const event = createMutationDefinition('mip.admin.events.clone', 'event-1', (section, label) => section === '活动信息' && label === '版本' ? '4' : '')
    const member = createMutationDefinition('mip.admin.memberships.grant', 'user-1', (section, label) => section === '会员权益' && label === '会员链版本' ? '9' : '')
    assert.equal(event.values.expectedVersion, '4')
    assert.equal(member.values.expectedChainVersion, '9')
  })

  it('normalizes form values while retaining hidden concurrency fields for retry', () => {
    const previous = { expectedVersion: '4', sendWechatReminder: true }
    const values = readMutationValues(new FormData(), previous, 'mip.admin.communications.publishEventReminder')
    assert.deepEqual(values, { expectedVersion: '4', sendWechatReminder: false })
  })

  it('builds exact neutral inputs and summaries for reviewed writes', () => {
    const member = state('mip.admin.memberships.grant', { durationMonths: '12', expectedChainVersion: '9', reason: '历史会员权益补录' })
    const event = state('mip.admin.events.clone', { expectedVersion: '4' })
    const reminder = state('mip.admin.communications.publishEventReminder', { expectedVersion: '4', sendWechatReminder: true })
    const refund = state('mip.admin.refunds.submit', { reason: '重复支付' })
    assert.deepEqual(mutationInput(member, member.values), { userId: 'resource-1', durationMonths: 12, expectedChainVersion: 9, reason: '历史会员权益补录' })
    assert.deepEqual(mutationInput(event, event.values), { sourceEventId: 'resource-1', expectedVersion: 4 })
    assert.deepEqual(mutationInput(reminder, reminder.values), { eventId: 'resource-1', expectedVersion: 4, sendWechatReminder: true })
    assert.deepEqual(mutationInput(refund, refund.values), { orderId: 'resource-1', reason: '重复支付' })
    assert.equal(mutationSummary('mip.admin.events.clone', event.values), '根据当前活动创建草稿')
  })

  it('escapes user-provided values in the dialog markup', () => {
    const value = '<退款原因>'
    const dialog = renderMutationDialog(state('mip.admin.refunds.submit', { reason: value }), escape)
    assert.match(dialog, /&lt;退款原因&gt;/)
    assert.doesNotMatch(dialog, /<退款原因>/)
  })
})
