import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
    assert.deepEqual(normalizeOperationValues(fields, {
      kind: 'CARD', card: '合作信息', case: '不应提交',
    }), { kind: 'CARD', card: '合作信息' })
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
