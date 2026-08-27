import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  readOperationValues,
  renderOperationDialog,
  type OperationField,
} from './admin-operation-ui.ts'

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

describe('admin operation UI', () => {
  it('renders typed fields without exposing hidden transport values', () => {
    const fields: OperationField[] = [
      { key: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
      { key: 'title', label: '<标题>', kind: 'text', required: true },
      { key: 'enabled', label: '启用', kind: 'checkbox' },
      { key: 'roles', label: '角色', kind: 'multi-select', options: ['connector', 'strategist'] },
    ]
    const html = renderOperationDialog({
      title: '<保存>', description: '服务端校验', fields,
      values: { expectedVersion: 3, title: 'MIP', enabled: true, roles: ['strategist'] },
      busy: false, error: '',
    }, escapeHtml)

    assert.match(html, /&lt;保存&gt;/)
    assert.match(html, /&lt;标题&gt;/)
    assert.doesNotMatch(html, /name="expectedVersion"/)
    assert.match(html, /value="strategist" selected/)
  })

  it('reads nested groups and typed lists while preserving hidden values', () => {
    const fields: OperationField[] = [
      { key: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
      { key: 'draft', label: '草稿', kind: 'group', fields: [
        { key: 'title', label: '标题', kind: 'text' },
        { key: 'tagIds', label: '标签', kind: 'id-list' },
        { key: 'cover', label: '素材', kind: 'asset-list' },
      ] },
    ]
    const data = new FormData()
    data.set('draft.title', ' 活动 ')
    data.set('draft.tagIds', 'tag-a\ntag-b')
    data.set('draft.cover', '00000000-0000-4000-8000-000000000001')

    assert.deepEqual(readOperationValues(fields, data, { expectedVersion: 2, draft: {} }), {
      expectedVersion: 2,
      draft: {
        title: '活动',
        tagIds: ['tag-a', 'tag-b'],
        cover: [{ assetId: '00000000-0000-4000-8000-000000000001', caption: '' }],
      },
    })
  })
})
