import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fieldsControlledBy,
  normalizeOperationValues,
  type OperationField,
} from './admin-operation-ui.ts'

describe('admin operation UI', () => {
  it('keeps selected recipient references as an array instead of comma-flattening them', () => {
    const fields: OperationField[] = [{ key: 'recipientRefs', label: '收件人', kind: 'profile-ref-list' }]
    const refs = ['opaque-recipient-a', 'opaque-recipient-b']
    assert.deepEqual(normalizeOperationValues(fields, { recipientRefs: refs }), { recipientRefs: refs })
  })
  it('normalizes nested groups and typed lists while preserving hidden values', () => {
    const fields: OperationField[] = [
      { key: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
      { key: 'draft', label: '草稿', kind: 'group', fields: [
        { key: 'title', label: '标题', kind: 'text' },
        { key: 'tagIds', label: '标签', kind: 'id-list' },
        { key: 'cover', label: '素材', kind: 'asset-list' },
      ] },
    ]
    assert.deepEqual(normalizeOperationValues(fields, {
      draft: {
        title: '活动',
        tagIds: 'tag-a\ntag-b',
        cover: '00000000-0000-4000-8000-000000000001',
      },
    }, { expectedVersion: 2, draft: {} }), {
      expectedVersion: 2,
      draft: {
        title: '活动',
        tagIds: ['tag-a', 'tag-b'],
        cover: [{ assetId: '00000000-0000-4000-8000-000000000001', caption: '' }],
      },
    })
  })

  it('normalizes nested React form values with the same transport shape', () => {
    const fields: OperationField[] = [
      { key: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
      { key: 'draft', label: '草稿', kind: 'group', fields: [
        { key: 'title', label: '标题', kind: 'text' },
        { key: 'tagIds', label: '标签', kind: 'id-list' },
      ] },
    ]

    assert.deepEqual(normalizeOperationValues(fields, {
      draft: { title: '活动', tagIds: 'tag-a\ntag-b' },
    }, { expectedVersion: 2, draft: {} }), {
      expectedVersion: 2,
      draft: { title: '活动', tagIds: ['tag-a', 'tag-b'] },
    })
  })

  it('preserves existing image captions when only the title changes', () => {
    const fields: OperationField[] = [{ key: 'draft', label: '草稿', kind: 'group', fields: [
      { key: 'title', label: '标题', kind: 'text' },
      { key: 'contentMedia', label: '活动介绍媒体', kind: 'asset-list' },
    ] }]
    const media = [
      { assetId: 'asset-a', caption: '入口照片' },
      { assetId: 'asset-b', caption: '现场全景' },
    ]

    assert.deepEqual(normalizeOperationValues(fields, {
      draft: { title: '新标题', contentMedia: 'asset-a\nasset-b' },
    }, { draft: { title: '旧标题', contentMedia: media } }), {
      draft: { title: '新标题', contentMedia: media },
    })
  })

  it('deduplicates string and structured asset lists while preserving retained captions', () => {
    const field: OperationField[] = [{ key: 'media', label: '素材', kind: 'asset-list' }]
    const previous = [
      { assetId: 'asset-a', caption: '应被删除' },
      { assetId: 'asset-b', caption: '保留说明' },
    ]

    assert.deepEqual(normalizeOperationValues(field, {
      media: 'asset-b\nasset-c\nasset-b',
    }, { media: previous }), {
      media: [
        { assetId: 'asset-b', caption: '保留说明' },
        { assetId: 'asset-c', caption: '' },
      ],
    })

    assert.deepEqual(normalizeOperationValues(field, {
      media: [
        { assetId: 'asset-b' },
        { assetId: 'asset-c' },
        { assetId: 'asset-c', caption: '重复项说明' },
        { assetId: 'asset-a', caption: '' },
      ],
    }, { media: previous }), {
      media: [
        { assetId: 'asset-b', caption: '保留说明' },
        { assetId: 'asset-c', caption: '' },
        { assetId: 'asset-a', caption: '' },
      ],
    })
  })

  it('normalizes only fields whose server-facing condition is active', () => {
    const fields: OperationField[] = [
      { key: 'kind', label: '类型', kind: 'select' },
      { key: 'card', label: '合作卡', kind: 'text', visibleWhen: { path: 'kind', value: 'CARD' } },
      { key: 'case', label: '案例', kind: 'text', visibleWhen: { path: 'kind', value: 'CASE' } },
    ]
    // Invisible fields are cleared to their empty value (never the stale
    // previous value, never the submitted value).
    assert.deepEqual(normalizeOperationValues(fields, {
      kind: 'CARD', card: '合作信息', case: '不应提交',
    }), { kind: 'CARD', card: '合作信息', case: '' })
  })
  it('keeps calendar dates local while converting timestamps to UTC', () => {
    const picker = { format: () => '2026-09-14', toISOString: () => '2026-09-13T16:00:00.000Z' }
    assert.deepEqual(normalizeOperationValues([
      { key: 'day', label: '日期', kind: 'date' },
      { key: 'timestamp', label: '时间', kind: 'datetime' },
    ], { day: picker, timestamp: picker }), {
      day: '2026-09-14', timestamp: '2026-09-13T16:00:00.000Z',
    })
  })

})

describe('R2 novice walkthrough fixes', () => {
  it('clears fields hidden by a linkage instead of carrying stale values into the payload', () => {
    const fields: OperationField[] = [
      { name: 'accessType', label: '收费类型', kind: 'select', options: [{ value: 'FREE', label: '免费' }, { value: 'PAID', label: '付费' }] },
      { name: 'priceCents', label: '金额（元）', kind: 'money', visibleWhen: { path: 'accessType', value: 'PAID' } },
      { name: 'targetType', label: '关联类型', kind: 'select', options: [] },
      { name: 'targetId', label: '关联内容', kind: 'text', visibleWhen: { path: 'targetType', value: ['EVENT', 'OPPORTUNITY'] } },
      { name: 'recipientRefs', label: '指定收件人', kind: 'multi-select', visibleWhen: { path: 'audienceType', value: 'EXPLICIT' } },
      { name: 'key', label: '内部标识', kind: 'text', hidden: true },
    ]
    const normalized = normalizeOperationValues(fields, { accessType: 'FREE', priceCents: '19900', targetType: '', targetId: 'event-stale', key: 'web-keep' }, {
      accessType: 'PAID', priceCents: '19900', targetType: 'EVENT', targetId: 'event-stale', recipientRefs: ['p1.x'], key: 'web-keep',
    })
    assert.equal(normalized.priceCents, '')
    assert.equal(normalized.targetId, '')
    assert.deepEqual(normalized.recipientRefs, [])
    // hidden technical fields still ride along from the base values
    assert.equal(normalized.key, 'web-keep')
  })

  it('keeps a shared path when any of its definitions is visible (role-shared target)', () => {
    const fields: OperationField[] = [
      { name: 'roleKey', label: '角色', kind: 'select', options: [{ value: 'strategist', label: '策略策划' }] },
      { name: 'target', label: '希望对接', kind: 'textarea', visibleWhen: { path: 'roleKey', value: 'connector' } },
      { name: 'target', label: '合作目标', kind: 'textarea', visibleWhen: { path: 'roleKey', value: 'strategist' } },
      { name: 'target', label: '合作目标', kind: 'textarea', visibleWhen: { path: 'roleKey', value: 'visual_designer' } },
    ]
    const normalized = normalizeOperationValues(fields, { roleKey: 'strategist', target: '对接目标' }, { roleKey: 'connector', target: '旧值' })
    assert.equal(normalized.target, '对接目标')
    // and when the role has no visible definition of the path at all, it clears
    const cleared = normalizeOperationValues(fields, { roleKey: 'other', target: '对接目标' }, { roleKey: 'connector', target: '旧值' })
    assert.equal(cleared.target, '')
  })

  it('lists dependent pickers whose options follow a controlling field', () => {
    const fields: OperationField[] = [
      { name: 'targetType', label: '关联类型', kind: 'select', options: [] },
      { name: 'targetId', label: '关联内容', kind: 'text', optionsActionByValue: { path: 'targetType', actions: { EVENT: 'a', OPPORTUNITY: 'b' } } },
    ]
    assert.deepEqual(fieldsControlledBy(fields, 'targetType'), ['targetId'])
    assert.deepEqual(fieldsControlledBy(fields, 'other'), [])
  })
})

describe('R3 novice walkthrough fixes', () => {
  it('treats optionsFilter-linked pickers as dependent on their controller', () => {
    const fields: OperationField[] = [
      { name: 'roleKey', label: '角色', kind: 'select', options: [] },
      { name: 'roleTemplateId', label: '岗位模板', kind: 'select', optionsAction: 'mip.admin.roles.templates.list', optionsFilter: { path: 'roleKey', key: 'baseRoleKey' } },
    ]
    assert.deepEqual(fieldsControlledBy(fields, 'roleKey'), ['roleTemplateId'])
  })
})
