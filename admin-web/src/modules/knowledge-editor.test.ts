import assert from 'node:assert/strict'
import { test } from 'node:test'
import { knowledgeEditorInput, knowledgeEditorValues } from './knowledge-editor.ts'

test('a nonempty knowledge detail can be edited with its version without submitting UI metadata', () => {
  const values = knowledgeEditorValues({ id: '66100000-0000-4000-8000-000000000003', version: 2,
    category: { id: '66100000-0000-4000-8000-000000000001' }, status: 'DRAFT', contentType: 'HOT_NEWS',
    title: '知识草稿', summary: '摘要', bodyText: '第一行\n第二行', accessType: 'FREE', commentsEnabled: false, moderationMode: 'AUTO' })
  const result = knowledgeEditorInput({ ...values, authorName: '修改作者' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.input.expectedVersion, 2)
  assert.equal(result.input.bodyText, '第一行\n第二行')
  assert.equal(result.input.authorName, '修改作者')
  assert.equal(Object.hasOwn(result.input, '_canSave'), false)
  assert.equal(knowledgeEditorInput({ ...values, injectedField: true }).ok, false)
})
