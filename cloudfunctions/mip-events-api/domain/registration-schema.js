'use strict'

const { DomainError } = require('./rules')

const FIELD_TYPES = new Set(['TEXT', 'TEXTAREA', 'SELECT', 'BOOLEAN'])
const FIELD_KEY = /^[a-z][a-z0-9_]{0,47}$/
const MAX_FIELDS = 12
const MAX_PAYLOAD_BYTES = 16 * 1024

function normalizeRegistrationSchema(value) {
  const source = parseSchema(value)
  if (!Array.isArray(source) || source.length > MAX_FIELDS) {
    throw validationError('报名表配置无效')
  }
  const keys = new Set()
  const schema = source.map((field) => {
    if (!isPlainObject(field)) throw validationError('报名表配置无效')
    const key = text(field.key)
    const label = text(field.label)
    const type = text(field.type).toUpperCase()
    if (!FIELD_KEY.test(key) || keys.has(key)
      || !label || label.length > 60 || /[\r\n]/.test(label)
      || !FIELD_TYPES.has(type)
      || (field.required !== undefined && typeof field.required !== 'boolean')) {
      throw validationError('报名表配置无效')
    }
    keys.add(key)
    const normalized = {
      key,
      label,
      type,
      required: field.required === true,
    }
    if (type === 'TEXT' || type === 'TEXTAREA') {
      const fallback = type === 'TEXT' ? 120 : 500
      const maximum = type === 'TEXT' ? 200 : 1000
      const maxLength = field.maxLength == null ? fallback : Number(field.maxLength)
      if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > maximum) {
        throw validationError('报名表配置无效')
      }
      normalized.maxLength = maxLength
    }
    if (type === 'SELECT') {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 20) {
        throw validationError('报名表配置无效')
      }
      const options = field.options.map(option => text(option))
      if (options.some(option => !option || option.length > 60 || /[\r\n]/.test(option))
        || new Set(options).size !== options.length) {
        throw validationError('报名表配置无效')
      }
      normalized.options = options
    }
    return normalized
  })
  if (byteLength(schema) > MAX_PAYLOAD_BYTES) throw validationError('报名表配置无效')
  return schema
}

function normalizeRegistrationAnswerPayload(value) {
  const answers = value == null ? {} : value
  if (!isPlainObject(answers) || byteLength(answers) > MAX_PAYLOAD_BYTES) {
    throw validationError('报名信息无效')
  }
  return answers
}

function normalizeRegistrationAnswers(schemaValue, answerValue) {
  const schema = normalizeRegistrationSchema(schemaValue)
  const answers = normalizeRegistrationAnswerPayload(answerValue)
  const fields = new Map(schema.map(field => [field.key, field]))
  if (Object.keys(answers).some(key => !fields.has(key))) {
    throw validationError('报名信息包含未定义字段')
  }
  const normalized = {}
  for (const field of schema) {
    const supplied = Object.hasOwn(answers, field.key)
    const value = supplied ? answers[field.key] : undefined
    if (field.type === 'BOOLEAN') {
      if (supplied && typeof value !== 'boolean') throw validationError(`${field.label}格式无效`)
      const checked = value === true
      if (field.required && !checked) throw validationError(`请填写${field.label}`)
      normalized[field.key] = checked
      continue
    }
    if (supplied && typeof value !== 'string') throw validationError(`${field.label}格式无效`)
    const answer = supplied ? value.trim() : ''
    if (field.required && !answer) throw validationError(`请填写${field.label}`)
    if (field.type === 'SELECT') {
      if (answer && !field.options.includes(answer)) throw validationError(`${field.label}选项无效`)
    }
    else if (answer.length > field.maxLength) {
      throw validationError(`${field.label}内容过长`)
    }
    normalized[field.key] = answer
  }
  if (byteLength(normalized) > MAX_PAYLOAD_BYTES) throw validationError('报名信息无效')
  return normalized
}

function parseSchema(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  }
  catch {
    throw validationError('报名表配置无效')
  }
}

function byteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  }
  catch {
    throw validationError('报名信息无效')
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validationError(message) {
  return new DomainError('VALIDATION_FAILED', message)
}

module.exports = {
  normalizeRegistrationAnswerPayload,
  normalizeRegistrationAnswers,
  normalizeRegistrationSchema,
}
