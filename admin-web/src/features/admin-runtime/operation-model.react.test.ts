import { describe, expect, it } from 'vitest'
import type { AdminDetailView } from '../../modules/admin-details'
import {
  createOperationModel,
  isReviewedOperationAction,
  operationCapability,
} from './operation-model'

const scores = {
  business_development: 1,
  resource_integration: 2,
  capital_operation: 3,
  strategy_planning: 4,
  visual_design: 5,
  delivery_management: 0,
}

describe('admin operation model', () => {
  const basicDetail: AdminDetailView = {
    route: 'events',
    title: '详情',
    subtitle: '',
    status: 'ACTIVE',
    sections: [
      { title: '活动信息', fields: [{ label: '版本', value: '4' }] },
      { title: '会员权益', fields: [{ label: '会员链版本', value: '9' }] },
    ],
  }

  it.each([
    {
      action: 'mip.admin.memberships.grant' as const,
      capability: 'memberships.adjust',
      title: '补录会员',
      description: '为该用户追加有效付费权益。提交前请确认会员时长和调整原因。',
      fields: [
        { name: 'expectedChainVersion', label: '会员链版本', kind: 'number', hidden: true },
        { name: 'durationMonths', label: '会员时长', kind: 'select', required: true, options: [
          { value: '1', label: '1 个月' }, { value: '3', label: '3 个月' },
          { value: '6', label: '6 个月' }, { value: '12', label: '12 个月' },
        ] },
        { name: 'reason', label: '调整原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
      ],
      values: { durationMonths: '12', expectedChainVersion: '9', reason: '' },
      submitted: { durationMonths: '12', expectedChainVersion: '9', reason: '历史会员权益补录' },
      input: { userId: 'resource-1', durationMonths: 12, expectedChainVersion: 9, reason: '历史会员权益补录' },
    },
    {
      action: 'mip.admin.events.clone' as const,
      capability: 'events.write',
      title: '克隆活动',
      description: '根据当前活动创建一份新的草稿活动。提交后由服务端重新校验权限和活动版本。',
      fields: [{ name: 'expectedVersion', label: '版本', kind: 'number', hidden: true }],
      values: { expectedVersion: '4' },
      submitted: { expectedVersion: '4' },
      input: { sourceEventId: 'resource-1', expectedVersion: 4 },
    },
    {
      action: 'mip.admin.events.changeStatus' as const,
      capability: 'events.write',
      title: '下架活动',
      description: '下架后活动不再接受新的公开报名，历史报名和订单事实会保留。',
      fields: [{ name: 'expectedVersion', label: '版本', kind: 'number', hidden: true }],
      values: { expectedVersion: '4', status: 'UNPUBLISHED' },
      submitted: { expectedVersion: '4', status: 'UNPUBLISHED' },
      input: { eventId: 'resource-1', expectedVersion: 4, status: 'UNPUBLISHED' },
      targetStatus: 'UNPUBLISHED' as const,
    },
    {
      action: 'mip.admin.events.archive' as const,
      capability: 'events.write',
      title: '归档活动',
      description: '仅可归档没有报名、订单、签到或相册记录的草稿活动。提交后活动历史仍会保留。',
      fields: [
        { name: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
        { name: 'reason', label: '归档原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
      ],
      values: { expectedVersion: '4', reason: '' },
      submitted: { expectedVersion: '4', reason: '重复草稿' },
      input: { eventId: 'resource-1', expectedVersion: 4, reason: '重复草稿' },
    },
    {
      action: 'mip.admin.communications.publishEventReminder' as const,
      capability: 'communications.publish',
      title: '发布活动提醒',
      description: '为当前活动生成提醒投递任务。只有已发布活动可以执行此操作。',
      fields: [
        { name: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
        { name: 'sendWechatReminder', label: '同时生成微信提醒任务', kind: 'checkbox', wide: true },
      ],
      values: { expectedVersion: '4', sendWechatReminder: true },
      submitted: { expectedVersion: '4', sendWechatReminder: true },
      input: { eventId: 'resource-1', expectedVersion: 4, sendWechatReminder: true },
    },
    {
      action: 'mip.admin.refunds.submit' as const,
      capability: 'refunds.submit',
      title: '提交退款',
      description: '提交当前订单的退款申请。金额和退款状态由服务端订单与支付流水决定。',
      fields: [{ name: 'reason', label: '退款原因', kind: 'textarea', required: true, maxLength: 300, wide: true }],
      values: { reason: '' },
      submitted: { reason: '重复支付' },
      input: { orderId: 'resource-1', reason: '重复支付' },
    },
  ])('keeps $action on the unified reviewed-operation path', async (testCase) => {
    expect(isReviewedOperationAction(testCase.action)).toBe(true)
    expect(operationCapability(testCase.action)).toBe(testCase.capability)
    const model = await createOperationModel(
      testCase.action,
      'resource-1',
      basicDetail,
      { targetStatus: testCase.targetStatus },
      async <T>() => ({} as T),
    )
    expect(model).toMatchObject({
      action: testCase.action,
      capability: testCase.capability,
      title: testCase.title,
      description: testCase.description,
      fields: testCase.fields,
      values: testCase.values,
    })
    expect(model.idempotencyKey).toMatch(/^[A-Za-z0-9_.:-]{12,128}$/)
    expect(model.buildInput(testCase.submitted)).toEqual(testCase.input)
  })

  it('keeps basic mutation validation inside the unified models', async () => {
    const request = async <T>() => ({} as T)
    const membership = await createOperationModel('mip.admin.memberships.grant', 'user-1', basicDetail, {}, request)
    const clone = await createOperationModel('mip.admin.events.clone', 'event-1', null, {}, request)
    const status = await createOperationModel('mip.admin.events.changeStatus', 'event-1', basicDetail, {}, request)
    const archive = await createOperationModel('mip.admin.events.archive', 'event-1', basicDetail, {}, request)
    const refund = await createOperationModel('mip.admin.refunds.submit', 'order-1', null, {}, request)
    expect(membership.buildInput({ ...membership.values, durationMonths: '2', reason: '补录' })).toBeNull()
    expect(clone.buildInput({ expectedVersion: 0 })).toBeNull()
    expect(status.title).toBe('发布活动')
    expect(status.buildInput({ expectedVersion: '4', status: 'ARCHIVED' })).toBeNull()
    expect(archive.buildInput({ expectedVersion: '4', reason: '' })).toBeNull()
    expect(refund.buildInput({ reason: '' })).toBeNull()
  })

  it('locks an event row version even if the form submits a different value', async () => {
    const model = await createOperationModel(
      'mip.admin.events.catalog.archive', 'catalog-1', null,
      { values: { kind: 'TAG', catalogId: 'catalog-1', expectedVersion: 4, reason: '' } },
      async <T>() => ({} as T),
    )
    expect(model.buildInput({ ...model.values, expectedVersion: 99, reason: '目录停用' })).toEqual({
      kind: 'TAG', catalogId: 'catalog-1', expectedVersion: 4, reason: '目录停用',
    })
  })

  it('locks a content row id and version at the launch boundary', async () => {
    const model = await createOperationModel(
      'mip.admin.announcements.withdraw', 'announcement-1', null,
      { values: { announcementId: 'announcement-1', expectedVersion: 3, reason: '' } },
      async <T>() => ({} as T),
    )
    expect(model.buildInput({ ...model.values, announcementId: 'announcement-2', expectedVersion: 99, reason: '内容已过期' })).toEqual({
      announcementId: 'announcement-1', expectedVersion: 3, reason: '内容已过期',
    })
  })

  it('submits only the selected cooperation-card structure', async () => {
    const model = await createOperationModel(
      'mip.admin.userContent.save', '', null,
      { values: { kind: 'COOPERATION_CARD' } }, async <T>() => ({} as T),
    )
    const input = model.buildInput({
      ...model.values,
      kind: 'COOPERATION_CARD',
      ownerUserId: 'user-1',
      draft: {
        ...(model.values.draft as Record<string, unknown>),
        roleKey: 'connector', positioning: '链接产业资源', targetSummary: '寻找合作伙伴',
        roleFields: {
          circles: '消费品牌', resources: '渠道资源', target: '品牌合作',
          industries: '不属于当前角色',
        },
        abilityScores: scores, projectName: '不应提交', status: 'DRAFT',
      },
    })

    expect(input).toEqual({
      kind: 'COOPERATION_CARD', ownerUserId: 'user-1',
      draft: {
        kind: 'COOPERATION_CARD', roleKey: 'connector', positioning: '链接产业资源',
        targetSummary: '寻找合作伙伴',
        roleFields: { circles: '消费品牌', resources: '渠道资源', target: '品牌合作' },
        abilityScores: scores, status: 'DRAFT',
      },
    })
  })

  it('submits only the selected super-case structure and date-only values', async () => {
    const model = await createOperationModel(
      'mip.admin.userContent.save', '', null,
      { values: { kind: 'SUPER_CASE' } }, async <T>() => ({} as T),
    )
    const input = model.buildInput({
      ...model.values,
      kind: 'SUPER_CASE',
      ownerUserId: 'user-1',
      draft: {
        ...(model.values.draft as Record<string, unknown>),
        projectName: '品牌升级', summary: '完成品牌升级', startedOn: '2030-01-02T00:00:00.000Z',
        responsibility: '负责品牌策略', description: '项目说明', mediaAssetIds: [],
        roleKey: 'connector', roleFields: { circles: '不应提交' }, status: 'DRAFT',
      },
    })

    expect(input?.kind).toBe('SUPER_CASE')
    expect((input?.draft as Record<string, unknown>).startedOn).toBe('2030-01-02')
    expect(Object.hasOwn(input?.draft as object, 'roleKey')).toBe(false)
  })
})
