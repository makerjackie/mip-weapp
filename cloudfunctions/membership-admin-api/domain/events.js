'use strict'

const ACTIVITY_TYPES = Object.freeze({
  PUBLIC_FREE: 'PUBLIC_FREE',
  MEMBER_INCLUDED: 'MEMBER_INCLUDED',
  PAID: 'PAID',
})

const REGISTRATION_MODES = Object.freeze({
  AUTO: 'AUTO',
  APPROVAL: 'APPROVAL',
})

const EVENT_MODES = Object.freeze({
  OFFLINE: 'OFFLINE',
  ONLINE: 'ONLINE',
  HYBRID: 'HYBRID',
})

const CANCELLED_BY_TYPES = Object.freeze({
  MEMBER: 'MEMBER',
  EVENT: 'EVENT',
  SYSTEM: 'SYSTEM',
})

const EVENT_TRANSITIONS = {
  DRAFT: new Set(['DRAFT', 'PUBLISHED', 'CANCELLED']),
  PUBLISHED: new Set(['PUBLISHED', 'CANCELLED', 'COMPLETED']),
  CANCELLED: new Set(['CANCELLED']),
  COMPLETED: new Set(['COMPLETED']),
}

const REGISTRATION_TRANSITIONS = {
  PENDING_REVIEW: new Set(['PENDING_REVIEW', 'REGISTERED', 'WAITLISTED', 'REJECTED', 'CANCELLED']),
  WAITLISTED: new Set(['WAITLISTED', 'REGISTERED', 'REJECTED', 'CANCELLED']),
  REGISTERED: new Set(['REGISTERED', 'ATTENDED', 'CANCELLED']),
  ATTENDED: new Set(['ATTENDED', 'REGISTERED']),
  CANCELLED: new Set(['CANCELLED']),
  REJECTED: new Set(['REJECTED']),
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

function text(value, max, code, required = false) {
  if (value === null || value === undefined) {
    if (required) throw new Error(code)
    return ''
  }
  if (typeof value !== 'string') throw new Error(code)
  const result = value.trim()
  if ((required && !result) || result.length > max) throw new Error(code)
  return result
}

function parseDate(value, code, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(code)
    return null
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(code)
  return date
}

function optionalUuid(value, code) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(code)
  return value
}

function optionalCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error('INVALID_EVENT_COORDINATES')
  }
  return Number(number.toFixed(7))
}

function normalizeOnlineUrl(value, required) {
  const url = text(value || '', 500, 'INVALID_EVENT_ONLINE_URL', required)
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
    throw new Error('INVALID_EVENT_ONLINE_URL')
  }
  return url
}

function normalizeVersion(value) {
  if (value === null || value === undefined || value === '') return 1
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw new Error('INVALID_EVENT_VERSION')
  return version
}

function normalizeRegistrationSchema(value) {
  const questions = value === undefined || value === null ? [] : value
  if (!Array.isArray(questions) || questions.length > 12) {
    throw new Error('INVALID_REGISTRATION_FORM')
  }
  const ids = new Set()
  return questions.map((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    const id = text(question.id, 64, 'INVALID_REGISTRATION_FORM', true)
    const type = String(question.type || '')
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id) || !QUESTION_TYPES.has(type)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    ids.add(id)
    const options = ['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type)
      ? [...new Set((Array.isArray(question.options) ? question.options : [])
          .map(item => text(item, 40, 'INVALID_REGISTRATION_FORM', true)))]
      : []
    if (['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type) && (options.length < 2 || options.length > 12)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    const profileField = question.profileField
      ? text(question.profileField, 32, 'INVALID_REGISTRATION_FORM', true)
      : null
    if (profileField && !PROFILE_FIELDS.has(profileField)) {
      throw new Error('INVALID_REGISTRATION_FORM')
    }
    return {
      id,
      label: text(question.label, 80, 'INVALID_REGISTRATION_FORM', true),
      description: text(question.description || '', 160, 'INVALID_REGISTRATION_FORM'),
      type,
      required: Boolean(question.required),
      options,
      profileField,
      privacy: ['PHONE', 'ID_CARD'].includes(type)
        ? 'ORGANIZER_ONLY'
        : question.privacy === 'PUBLIC_WITH_CONSENT'
        ? 'PUBLIC_WITH_CONSENT'
        : 'ORGANIZER_ONLY',
      sortOrder: index,
    }
  })
}

/**
 * Central activity-type mapping. Pages must not recombine booleans themselves.
 * Unsupported: priceCents > 0 && memberFree (member-free + paid dual pricing).
 */
function resolveActivityType(priceCents, memberFree) {
  const cents = Number(priceCents || 0)
  const freeForMembers = Boolean(memberFree)
  if (!Number.isInteger(cents) || cents < 0) throw new Error('INVALID_EVENT_PRICE')
  if (cents > 0 && freeForMembers) throw new Error('INVALID_EVENT_PRICE_COMBINATION')
  if (cents > 0) return ACTIVITY_TYPES.PAID
  if (freeForMembers) return ACTIVITY_TYPES.MEMBER_INCLUDED
  return ACTIVITY_TYPES.PUBLIC_FREE
}

function flagsFromActivityType(activityType, priceCents) {
  switch (activityType) {
    case ACTIVITY_TYPES.PUBLIC_FREE:
      return { memberFree: false, priceCents: 0 }
    case ACTIVITY_TYPES.MEMBER_INCLUDED:
      return { memberFree: true, priceCents: 0 }
    case ACTIVITY_TYPES.PAID: {
      const cents = Number(priceCents || 0)
      if (!Number.isInteger(cents) || cents < 1) throw new Error('INVALID_EVENT_PRICE')
      return { memberFree: false, priceCents: cents }
    }
    default:
      throw new Error('INVALID_ACTIVITY_TYPE')
  }
}

function normalizePriceFlags(value) {
  if (value.activityType !== undefined && value.activityType !== null && value.activityType !== '') {
    const flags = flagsFromActivityType(value.activityType, value.priceCents)
    return {
      ...flags,
      activityType: resolveActivityType(flags.priceCents, flags.memberFree),
    }
  }
  const memberFree = Boolean(value.memberFree)
  const priceCents = Number(value.priceCents || 0)
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error('INVALID_EVENT_PRICE')
  if (priceCents > 0 && memberFree) throw new Error('INVALID_EVENT_PRICE_COMBINATION')
  return {
    memberFree,
    priceCents,
    activityType: resolveActivityType(priceCents, memberFree),
  }
}

function normalizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_EVENT')

  const startsAt = parseDate(value.startsAt, 'INVALID_EVENT_DATE', true)
  // Compat: older admin clients only send startsAt; default to a one-hour window.
  const endsAt = parseDate(value.endsAt, 'INVALID_EVENT_ENDS_AT')
    || new Date(startsAt.getTime() + 60 * 60 * 1000)
  if (endsAt.getTime() <= startsAt.getTime()) throw new Error('INVALID_EVENT_TIME_RANGE')

  const registrationDeadline = parseDate(value.registrationDeadline, 'INVALID_EVENT_DEADLINE')
  if (registrationDeadline && registrationDeadline.getTime() > startsAt.getTime()) {
    throw new Error('INVALID_EVENT_DEADLINE')
  }

  const eventMode = Object.values(EVENT_MODES).includes(value.eventMode)
    ? value.eventMode
    : EVENT_MODES.OFFLINE
  const venueName = text(value.venueName || '', 120, 'INVALID_EVENT_VENUE')
  const address = text(value.address || '', 300, 'INVALID_EVENT_ADDRESS')
  // location remains the compatibility display field for older clients and list cards.
  const location = text(
    value.location || venueName || address || (eventMode === EVENT_MODES.ONLINE ? '线上活动' : ''),
    255,
    'INVALID_EVENT_LOCATION',
    true,
  )

  const capacity = value.capacity === null || value.capacity === '' || value.capacity === undefined
    ? null
    : Number(value.capacity)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)) {
    throw new Error('INVALID_EVENT_CAPACITY')
  }

  const { memberFree, priceCents, activityType } = normalizePriceFlags(value)
  const registrationMode = value.registrationMode === REGISTRATION_MODES.APPROVAL
    ? REGISTRATION_MODES.APPROVAL
    : REGISTRATION_MODES.AUTO
  const waitlistEnabled = Boolean(value.waitlistEnabled)
  if (activityType === ACTIVITY_TYPES.PAID
    && (registrationMode !== REGISTRATION_MODES.AUTO || waitlistEnabled)) {
    throw new Error('UNSUPPORTED_PAID_REGISTRATION_POLICY')
  }
  const latitude = optionalCoordinate(value.latitude, -90, 90)
  const longitude = optionalCoordinate(value.longitude, -180, 180)
  if ((latitude === null) !== (longitude === null)) {
    throw new Error('INVALID_EVENT_COORDINATES')
  }
  const onlineUrl = normalizeOnlineUrl(
    value.onlineUrl,
    eventMode === EVENT_MODES.ONLINE || eventMode === EVENT_MODES.HYBRID,
  )

  return {
    title: text(value.title, 50, 'INVALID_EVENT_TITLE', true),
    description: text(value.description || '', 2000, 'INVALID_EVENT_DESCRIPTION'),
    notices: text(value.notices || '', 3000, 'INVALID_EVENT_NOTICES'),
    registrationSchema: normalizeRegistrationSchema(value.registrationSchema),
    registrationMode,
    waitlistEnabled,
    albumEnabled: value.albumEnabled !== false,
    albumRequiresReview: value.albumRequiresReview !== false,
    startsAt,
    endsAt,
    registrationDeadline,
    venueName,
    address,
    location,
    eventMode,
    latitude,
    longitude,
    onlineUrl,
    capacity,
    cancellationPolicy: text(value.cancellationPolicy || '', 1000, 'INVALID_EVENT_CANCELLATION_POLICY'),
    coverAssetId: optionalUuid(value.coverAssetId, 'INVALID_EVENT_COVER'),
    version: normalizeVersion(value.version),
    memberFree,
    priceCents,
    activityType,
  }
}

function assertEventTransition(from, to) {
  if (!EVENT_TRANSITIONS[from] || !EVENT_TRANSITIONS[from].has(to)) {
    throw new Error('INVALID_EVENT_TRANSITION')
  }
}

/**
 * Registration state machine for pure domain checks.
 * CANCELLED → REGISTERED re-activation is owned by the registration transaction, not free transition.
 * ATTENDED → REGISTERED is only for undoing a mistaken check-in.
 * Event cancel converges REGISTERED only and must not erase ATTENDED history (workflow concern).
 */
function assertRegistrationTransition(from, to) {
  if (!REGISTRATION_TRANSITIONS[from] || !REGISTRATION_TRANSITIONS[from].has(to)) {
    throw new Error('INVALID_REGISTRATION_TRANSITION')
  }
}

function assertEventPublishable(event, now = new Date()) {
  if (!event || !(event.startsAt instanceof Date) || Number.isNaN(event.startsAt.getTime())) {
    throw new Error('INVALID_EVENT_DATE')
  }
  if (event.startsAt.getTime() <= now.getTime()) {
    throw new Error('INVALID_EVENT_STARTS_AT')
  }
}

function assertCancelledByType(value) {
  if (value === null || value === undefined || value === '') return null
  if (!Object.values(CANCELLED_BY_TYPES).includes(value)) {
    throw new Error('INVALID_CANCELLED_BY_TYPE')
  }
  return value
}

module.exports = {
  ACTIVITY_TYPES,
  CANCELLED_BY_TYPES,
  EVENT_MODES,
  REGISTRATION_MODES,
  assertCancelledByType,
  assertEventPublishable,
  assertEventTransition,
  assertRegistrationTransition,
  flagsFromActivityType,
  normalizeEvent,
  normalizeRegistrationSchema,
  resolveActivityType,
}
