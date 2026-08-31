import { describe, expect, it } from 'vitest'
import { createOperationModel } from './operation-model'

const scores = {
  business_development: 1,
  resource_integration: 2,
  capital_operation: 3,
  strategy_planning: 4,
  visual_design: 5,
  delivery_management: 0,
}

describe('admin operation model', () => {
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
