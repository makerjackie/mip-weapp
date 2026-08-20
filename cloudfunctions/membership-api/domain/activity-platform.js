'use strict'

const QUESTION_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'PHONE',
  'ID_CARD',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
])
const PROFILE_FIELDS = new Set([
  'nickname',
  'city',
  'organization',
  'roleTitle',
  'industry',
  'phone',
  'interests',
  'skills',
])
const QUESTION_ID = /^[A-Za-z0-9_-]{1,64}$/

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function boundedText(value, maximum, code, required = false) {
  if (value === null || value === undefined) {
    if (required) throw new Error(code)
    return ''
  }
  if (typeof value !== 'string') throw new Error(code)
  const text = value.trim()
  if ((required && !text) || text.length > maximum) throw new Error(code)
  return text
}

function normalizeRegistrationSchema(value) {
  const list = value === null || value === undefined ? [] : value
  if (!Array.isArray(list) || list.length > 12) {
    throw new Error('INVALID_REGISTRATION_FORM')
  }
  const seen = new Set()
  return list.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!QUESTION_ID.test(id) || seen.has(id)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    seen.add(id)
    const type = String(raw.type || '')
    if (!QUESTION_TYPES.has(type)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    const options = ['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type)
      ? [...new Set((Array.isArray(raw.options) ? raw.options : [])
          .map(item => boundedText(item, 40, 'INVALID_REGISTRATION_FORM', true)))]
      : []
    if (['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type) && (options.length < 2 || options.length > 12)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    const profileField = raw.profileField ? String(raw.profileField) : null
    if (profileField && !PROFILE_FIELDS.has(profileField)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    return {
      id,
      label: boundedText(raw.label, 80, 'INVALID_REGISTRATION_FORM', true),
      description: boundedText(raw.description || '', 160, 'INVALID_REGISTRATION_FORM'),
      type,
      required: Boolean(raw.required),
      options,
      profileField,
      privacy: ['PHONE', 'ID_CARD'].includes(type)
        ? 'ORGANIZER_ONLY'
        : raw.privacy === 'PUBLIC_WITH_CONSENT' ? 'PUBLIC_WITH_CONSENT' : 'ORGANIZER_ONLY',
      sortOrder: index,
    }
  })
}

function normalizeStringAnswer(value, max, required) {
  if (value === null || value === undefined) {
    if (required) throw new Error('REGISTRATION_ANSWERS_REQUIRED')
    return ''
  }
  if (typeof value !== 'string') throw new Error('INVALID_REGISTRATION_ANSWERS')
  const text = value.trim()
  if ((required && !text) || text.length > max) {
    throw new Error(required && !text ? 'REGISTRATION_ANSWERS_REQUIRED' : 'INVALID_REGISTRATION_ANSWERS')
  }
  return text
}

function validPhone(value) {
  return /^1[3-9]\d{9}$/.test(value)
}

function validIdCard(value) {
  if (!/^\d{17}[\dX]$/i.test(value)) return false
  const birth = value.slice(6, 14)
  const year = Number(birth.slice(0, 4))
  const month = Number(birth.slice(4, 6))
  const day = Number(birth.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0)
  return checks[sum % 11] === value[17].toUpperCase()
}

function validateRegistrationAnswers(schemaValue, answerValue) {
  const schema = normalizeRegistrationSchema(schemaValue)
  const answers = answerValue && typeof answerValue === 'object' && !Array.isArray(answerValue)
    ? answerValue
    : {}
  const allowed = new Set(schema.map(question => question.id))
  if (Object.keys(answers).some(key => !allowed.has(key))) {
    throw new Error('INVALID_REGISTRATION_ANSWERS')
  }
  const result = {}
  for (const question of schema) {
    const value = answers[question.id]
    switch (question.type) {
      case 'SHORT_TEXT':
        result[question.id] = normalizeStringAnswer(value, 120, question.required)
        break
      case 'LONG_TEXT':
        result[question.id] = normalizeStringAnswer(value, 1000, question.required)
        break
      case 'NUMBER': {
        if ((value === '' || value === null || value === undefined) && !question.required) {
          result[question.id] = null
          break
        }
        const number = Number(value)
        if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) {
          throw new Error('INVALID_REGISTRATION_ANSWERS')
        }
        result[question.id] = number
        break
      }
      case 'PHONE': {
        const phone = normalizeStringAnswer(value, 11, question.required)
        if (phone && !validPhone(phone)) throw new Error('INVALID_REGISTRATION_ANSWERS')
        result[question.id] = phone
        break
      }
      case 'ID_CARD': {
        const idCard = normalizeStringAnswer(value, 18, question.required).toUpperCase()
        if (idCard && !validIdCard(idCard)) throw new Error('INVALID_REGISTRATION_ANSWERS')
        result[question.id] = idCard
        break
      }
      case 'BOOLEAN':
        if (question.required && value !== true) {
          throw new Error('REGISTRATION_ANSWERS_REQUIRED')
        }
        if (typeof value !== 'boolean') {
          if (!question.required && (value === undefined || value === null || value === '')) {
            result[question.id] = false
            break
          }
          throw new Error('INVALID_REGISTRATION_ANSWERS')
        }
        result[question.id] = value
        break
      case 'SINGLE_CHOICE':
        if ((value === '' || value === null || value === undefined) && !question.required) {
          result[question.id] = ''
          break
        }
        if (typeof value !== 'string' || !question.options.includes(value)) {
          throw new Error('INVALID_REGISTRATION_ANSWERS')
        }
        result[question.id] = value
        break
      case 'MULTI_CHOICE': {
        const selected = Array.isArray(value) ? [...new Set(value)] : []
        if (question.required && !selected.length) {
          throw new Error('REGISTRATION_ANSWERS_REQUIRED')
        }
        if (selected.length > question.options.length
          || selected.some(item => typeof item !== 'string' || !question.options.includes(item))) {
          throw new Error('INVALID_REGISTRATION_ANSWERS')
        }
        result[question.id] = selected
        break
      }
      default:
        throw new Error('INVALID_REGISTRATION_FORM')
    }
  }
  return { schema, answers: result }
}

function profilePrefillValue(question, profile, privateProfile) {
  if (!question?.profileField) return undefined
  switch (question.profileField) {
    case 'nickname': return profile?.nickname || ''
    case 'city': return profile?.city || ''
    case 'organization': return profile?.organization || ''
    case 'roleTitle': return profile?.role_title || ''
    case 'industry': return profile?.industry || ''
    case 'phone': return maskPhoneNumber(privateProfile?.phone_number)
    case 'interests': return parseJsonArray(profile?.interests)
    case 'skills': return parseJsonArray(profile?.skills)
    default: return undefined
  }
}

function maskPhoneNumber(value) {
  const phone = typeof value === 'string' ? value.trim() : ''
  return phone ? `已绑定手机号 · ${phone.slice(-4)}` : ''
}

function resolvePrivateProfileAnswers(schemaValue, answerValue, privateProfile) {
  if (!answerValue || typeof answerValue !== 'object' || Array.isArray(answerValue)) {
    return answerValue
  }
  const answers = { ...answerValue }
  const phone = typeof privateProfile?.phone_number === 'string'
    ? privateProfile.phone_number.trim()
    : ''
  if (!phone) {
    return answers
  }
  const maskedPhone = maskPhoneNumber(phone)
  for (const question of normalizeRegistrationSchema(schemaValue)) {
    if (question.profileField === 'phone' && answers[question.id] === maskedPhone) {
      answers[question.id] = phone
    }
  }
  return answers
}

function publicRegistrationForm(schemaValue, profile, privateProfile) {
  return normalizeRegistrationSchema(schemaValue).map(question => ({
    ...question,
    prefillValue: profilePrefillValue(question, profile, privateProfile),
  }))
}

function activityType(event) {
  if (Number(event?.price_cents || 0) > 0) return 'PAID'
  return event?.member_free ? 'MEMBER_INCLUDED' : 'PUBLIC_FREE'
}

module.exports = {
  QUESTION_TYPES,
  activityType,
  normalizeRegistrationSchema,
  parseJsonArray,
  publicRegistrationForm,
  resolvePrivateProfileAnswers,
  validateRegistrationAnswers,
}
