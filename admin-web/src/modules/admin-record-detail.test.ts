import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRecordDetail } from './admin-record-detail.ts'

describe('admin record detail', () => {
  it('accepts a well-formed read-only detail', () => {
    assert.equal(isRecordDetail({ title: '举报详情', entries: [{ label: '分类', value: '骚扰' }] }), true)
  })

  it('rejects partial or mistyped shapes so the UI never renders an empty dialog', () => {
    assert.equal(isRecordDetail(null), false)
    assert.equal(isRecordDetail({}), false)
    assert.equal(isRecordDetail({ title: 'x' }), false)
    assert.equal(isRecordDetail({ title: 'x', entries: 'no' }), false)
    assert.equal(isRecordDetail([{ label: 'a', value: 'b' }]), false)
  })
})
