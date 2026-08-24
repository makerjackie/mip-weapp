'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  normalizeRegistrationAnswerPayload,
  normalizeRegistrationAnswers,
  normalizeRegistrationSchema,
} = require('../domain/registration-schema')

const schema = [
  { key: 'role', label: '参与身份', type: 'SELECT', required: true, options: ['玩家', '嘉宾'] },
  { key: 'introduction', label: '自我介绍', type: 'TEXTAREA', required: true, maxLength: 120 },
  { key: 'needs_accessibility', label: '需要无障碍协助', type: 'BOOLEAN', required: false },
]

describe('MIP event registration schema', () => {
  it('normalizes configured fields and server-owned limits', () => {
    assert.deepEqual(normalizeRegistrationSchema(schema), schema)
    assert.deepEqual(normalizeRegistrationSchema([
      { key: 'name', label: '姓名', type: 'text', required: false },
    ]), [
      { key: 'name', label: '姓名', type: 'TEXT', required: false, maxLength: 120 },
    ])
  })

  it('rejects duplicate, parentless, and oversized field definitions', () => {
    assert.throws(() => normalizeRegistrationSchema([
      { key: 'role', label: '身份', type: 'TEXT', required: false },
      { key: 'role', label: '重复身份', type: 'TEXT', required: false },
    ]), error => error.code === 'VALIDATION_FAILED')
    assert.throws(() => normalizeRegistrationSchema([
      { key: 'Role Name', label: '身份', type: 'TEXT', required: false },
    ]), error => error.code === 'VALIDATION_FAILED')
    assert.throws(() => normalizeRegistrationSchema([
      { key: 'role', label: '身份', type: 'SELECT', required: false, options: [] },
    ]), error => error.code === 'VALIDATION_FAILED')
    assert.throws(() => normalizeRegistrationSchema([
      { key: 'role', label: '身份', type: 'TEXT', required: 'false' },
    ]), error => error.code === 'VALIDATION_FAILED')
  })
})

describe('MIP event registration answers', () => {
  it('keeps only schema fields and normalizes values', () => {
    assert.deepEqual(normalizeRegistrationAnswers(schema, {
      role: ' 玩家 ',
      introduction: '  负责产品与运营  ',
      needs_accessibility: false,
    }), {
      role: '玩家',
      introduction: '负责产品与运营',
      needs_accessibility: false,
    })
  })

  it('rejects missing, invalid option, wrong type, extra field, and overlong values', () => {
    const valid = { role: '玩家', introduction: '产品负责人', needs_accessibility: false }
    const invalid = [
      { ...valid, introduction: '' },
      { ...valid, role: '观察员' },
      { ...valid, needs_accessibility: 'false' },
      { ...valid, internal_note: '不可提交' },
      { ...valid, introduction: '介'.repeat(121) },
    ]
    for (const answers of invalid) {
      assert.throws(() => normalizeRegistrationAnswers(schema, answers), error => error.code === 'VALIDATION_FAILED')
    }
  })

  it('rejects non-object and oversized payloads before database work', () => {
    assert.throws(() => normalizeRegistrationAnswerPayload([]), error => error.code === 'VALIDATION_FAILED')
    assert.throws(
      () => normalizeRegistrationAnswerPayload({ text: 'a'.repeat(17 * 1024) }),
      error => error.code === 'VALIDATION_FAILED',
    )
  })
})
