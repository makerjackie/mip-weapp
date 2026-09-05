'use strict'

const { AdminError } = require('./validation')

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
  return new AdminError('VALIDATION_FAILED', message)
}

module.exports = { normalizeRegistrationSchema }
