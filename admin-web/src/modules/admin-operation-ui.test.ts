import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeOperationValues,
  type OperationField,
} from './admin-operation-ui.ts'

describe('admin operation UI', () => {
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
})
