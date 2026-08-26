'use strict'

const { createHash } = require('node:crypto')
const { CAPABILITIES } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, requiredId } = require('./validation')

const INPUT_KEYS = new Set([
  'userId',
  'kind',
  'direction',
  'occurredFrom',
  'occurredTo',
  'cursor',
  'limit',
])
const KINDS = new Set(['INVITATION', 'HEART', 'VISIT'])
const DIRECTIONS = new Set(['ALL', 'INCOMING', 'OUTGOING'])
const CURSOR_FIELDS = [
  'subject',
  'kind',
  'direction',
  'from',
  'to',
  'occurredAt',
  'id',
]

function createUserInfluenceService({ access, repository }) {
  async function listUserInfluence(caller, rawInput = {}) {
    const context = await access.session(caller)
    const input = normalizeInput(rawInput)
    const { scope, grant } = await access.userAuthorization(
      context,
      input.userId,
      CAPABILITIES.USERS_READ,
    )
    const cursorContext = {
      subject: opaqueReference('subject', context.caller.appId, input.userId),
      kind: input.kind,
      direction: input.direction,
      from: input.occurredFrom || '-',
      to: input.occurredTo || '-',
    }
    const cursor = decodeInfluenceCursor(input.cursor, cursorContext)
    const page = await repository.listUserInfluence(
      context.caller.appId,
      input.userId,
      {
        kind: input.kind,
        direction: input.direction,
        occurredFrom: input.occurredFrom,
        occurredTo: input.occurredTo,
        cursor,
        cursorContext,
      },
      input.limit,
    )
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      action: 'admin.users.influence.view',
      resourceType: 'USER',
      resourceId: input.userId,
      metadata: {
        kind: input.kind,
        direction: input.direction,
        count: page.items.length,
        hasCursor: Boolean(input.cursor),
        hasTimeRange: Boolean(input.occurredFrom || input.occurredTo),
      },
    }))
    return {
      items: page.items.map(item => projectFact(item, context.caller.appId)),
      nextCursor: page.nextCursor || null,
      unavailableFacts: input.kind === 'HEART' && input.direction !== 'OUTGOING'
        ? ['CANCELLED_INCOMING_HEART']
        : [],
    }
  }

  return { listUserInfluence }
}

function normalizeInput(value) {
  if (!isExactInput(value)) {
    throw new AdminError('VALIDATION_FAILED', '用户影响力查询无效')
  }
  const userId = requiredId(value.userId, '用户')
  if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) {
    throw new AdminError('VALIDATION_FAILED', '影响力类型无效')
  }
  const direction = Object.hasOwn(value, 'direction') ? value.direction : 'ALL'
  if (typeof direction !== 'string' || !DIRECTIONS.has(direction)) {
    throw new AdminError('VALIDATION_FAILED', '影响力方向无效')
  }
  const occurredFrom = Object.hasOwn(value, 'occurredFrom')
    ? dateTime(value.occurredFrom, '开始时间')
    : ''
  const occurredTo = Object.hasOwn(value, 'occurredTo')
    ? dateTime(value.occurredTo, '结束时间')
    : ''
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    throw new AdminError('VALIDATION_FAILED', '开始时间不能晚于结束时间')
  }
  const limit = Object.hasOwn(value, 'limit') ? value.limit : 20
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    throw new AdminError('VALIDATION_FAILED', '分页数量无效')
  }
  if (Object.hasOwn(value, 'cursor')
    && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 512)) {
    throw new AdminError('VALIDATION_FAILED', '分页游标无效')
  }
  return {
    userId,
    kind: value.kind,
    direction,
    occurredFrom,
    occurredTo,
    cursor: value.cursor || null,
    limit,
  }
}

function isExactInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const keys = Reflect.ownKeys(value)
  return Object.hasOwn(value, 'userId')
    && Object.hasOwn(value, 'kind')
    && keys.every(key => typeof key === 'string' && INPUT_KEYS.has(key))
}

function dateTime(value, label) {
  if (typeof value !== 'string' || !value || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function decodeInfluenceCursor(value, expected) {
  const cursor = decodeCursor(value, CURSOR_FIELDS)
  if (!cursor) return null
  const allowedKeys = new Set(['v', ...CURSOR_FIELDS])
  if (Reflect.ownKeys(cursor).length !== allowedKeys.size
    || Reflect.ownKeys(cursor).some(key => typeof key !== 'string' || !allowedKeys.has(key))
    || cursor.subject !== expected.subject
    || cursor.kind !== expected.kind
    || cursor.direction !== expected.direction
    || cursor.from !== expected.from
    || cursor.to !== expected.to) {
    throw new AdminError('VALIDATION_FAILED', '分页游标与当前筛选条件不一致')
  }
  return cursor
}

function projectFact(item, appId) {
  return {
    reference: opaqueReference(item.kind.toLowerCase(), appId, item.id),
    kind: item.kind,
    direction: item.direction,
    status: item.status,
    occurredAt: item.occurredAt,
    eventTitle: item.eventTitle,
    counterpartNickname: item.counterpartNickname,
    counterpartKind: item.counterpartKind,
    counterpartState: item.counterpartState,
    sourceType: item.sourceType,
  }
}

function opaqueReference(namespace, appId, id) {
  const digest = createHash('sha256')
    .update(`${namespace}\0${appId}\0${id}`, 'utf8')
    .digest('base64url')
    .slice(0, 22)
  return `if1.${digest}`
}

module.exports = {
  createUserInfluenceService,
  normalizeUserInfluenceInput: normalizeInput,
}
