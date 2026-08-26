'use strict'

const { randomUUID } = require('node:crypto')

const entitlementStatuses = new Set(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'])
const platformScope = Object.freeze({ scopeType: 'PLATFORM', scopeId: null })

function createMembershipRepository(database, options = {}) {
  const assertMutationScope = options.assertMutationScope
  const createId = options.createId || randomUUID
  const lockMutationAuthorization = options.lockMutationAuthorization
  const now = options.now || (() => new Date())
  const support = options.repositorySupport || {}
  const codeError = support.codeError || defaultCodeError
  const duplicateConstraint = support.duplicateConstraint || defaultDuplicateConstraint
  const iso = support.iso || defaultIso
  const writeAudit = options.writeAudit
  const writeOutbox = options.writeOutbox

  async function getMembership(input) {
    const rows = await database.query(
      `SELECT user_row.id AS user_id, user_row.status AS user_status,
              profile.nickname, membership_chain.version AS chain_version,
              entitlement.id AS entitlement_id, entitlement.source_type,
              entitlement.status AS entitlement_status, entitlement.starts_at,
              entitlement.ends_at, entitlement.order_id, entitlement.plan_id,
              entitlement.source_adjustment_id,
              adjustment.id AS adjustment_id,
              adjustment.duration_months AS adjustment_duration_months,
              adjustment.reason AS adjustment_reason,
              adjustment.created_at AS adjustment_created_at,
              adjustment.expected_chain_version,
              adjustment.result_chain_version,
              actor_profile.nickname AS actor_nickname
       FROM mip_users user_row
       LEFT JOIN mip_profiles profile
         ON profile.app_id = user_row.app_id AND profile.user_id = user_row.id
       LEFT JOIN mip_membership_chains membership_chain
         ON membership_chain.app_id = user_row.app_id
           AND membership_chain.user_id = user_row.id
       LEFT JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = user_row.app_id AND entitlement.user_id = user_row.id
       LEFT JOIN mip_membership_adjustments adjustment
         ON adjustment.app_id = entitlement.app_id
           AND adjustment.user_id = entitlement.user_id
           AND adjustment.id = entitlement.source_adjustment_id
       LEFT JOIN mip_profiles actor_profile
         ON actor_profile.app_id = adjustment.app_id
           AND actor_profile.user_id = adjustment.actor_user_id
       WHERE user_row.app_id = ? AND user_row.id = ?
       ORDER BY entitlement.starts_at DESC, entitlement.id DESC`,
      [input.appId, input.userId],
    )
    if (!rows.length) throw codeError('NOT_FOUND')
    const chainVersion = positiveVersion(rows[0].chain_version, codeError)
    const evaluatedAt = validDate(now(), codeError)
    const entitlements = rows[0].entitlement_id
      ? rows.map(row => entitlementDto(row, evaluatedAt, { codeError, iso }))
      : []
    return {
      user: {
        id: String(rows[0].user_id),
        nickname: displayName(rows[0].nickname),
        status: rows[0].user_status,
      },
      chainVersion,
      membership: membershipSummary(entitlements, evaluatedAt),
      entitlements,
    }
  }

  async function grantMembership(input) {
    try {
      return await database.transaction(tx => grantInTransaction(tx, input))
    }
    catch (error) {
      if (!duplicateConstraint(error)) throw error
      return recoverUniqueRace(input)
    }
  }

  async function grantInTransaction(tx, input) {
    const authorization = await lockMutationAuthorization(tx, input)
    assertMutationScope(authorization, platformScope)
    const targetUser = await lockTargetUser(tx, input)
    const chain = await lockMembershipChain(tx, input)
    const replay = await findReplay(tx, input)
    if (replay) return replayResult(replay, input, { codeError, iso })
    if (!['ACTIVE', 'BLOCKED'].includes(targetUser.status)) throw codeError('INVALID_STATE')
    if (chain.version !== input.expectedChainVersion) throw codeError('VERSION_CONFLICT')

    const entitlements = await tx.query(
      `SELECT id, status, starts_at, ends_at
       FROM mip_membership_entitlements
       WHERE app_id = ? AND user_id = ?
       ORDER BY starts_at ASC, id ASC FOR UPDATE`,
      [input.appId, input.userId],
    )
    const startsAt = membershipWindowStart(entitlements, now(), codeError)
    const endsAt = addUtcCalendarMonths(startsAt, input.durationMonths, codeError)
    const resultChainVersion = input.expectedChainVersion + 1
    const adjustmentId = createId()
    const entitlementId = createId()

    await tx.query(
      `INSERT INTO mip_membership_adjustments (
        id, app_id, user_id, duration_months, reason, actor_user_id,
        idempotency_key, request_hash, expected_chain_version, result_chain_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adjustmentId,
        input.appId,
        input.userId,
        input.durationMonths,
        input.reason,
        input.actorUserId,
        input.idempotencyKey,
        input.requestHash,
        input.expectedChainVersion,
        resultChainVersion,
      ],
    )
    await tx.query(
      `INSERT INTO mip_membership_entitlements (
        id, app_id, user_id, order_id, plan_id, source_type,
        source_adjustment_id, status, starts_at, ends_at
      ) VALUES (?, ?, ?, NULL, NULL, 'ADMIN_ADJUSTMENT', ?, 'ACTIVE', ?, ?)`,
      [entitlementId, input.appId, input.userId, adjustmentId, startsAt, endsAt],
    )
    const chainUpdate = await tx.query(
      `UPDATE mip_membership_chains
       SET version = version + 1
       WHERE app_id = ? AND user_id = ? AND version = ?`,
      [input.appId, input.userId, input.expectedChainVersion],
    )
    if (Number(chainUpdate?.affectedRows) !== 1) throw codeError('VERSION_CONFLICT')

    const facts = {
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      resultChainVersion,
    }
    await writeAudit(tx, input.audit(adjustmentId, facts))
    await writeOutbox(tx, {
      id: createId(),
      appId: input.appId,
      aggregateType: 'MEMBERSHIP_ADJUSTMENT',
      aggregateId: adjustmentId,
      eventType: 'membership.adjustment_granted',
      sourceVersion: resultChainVersion,
      payload: {},
    })
    return {
      adjustmentId,
      resultChainVersion,
      startsAt: facts.startsAt,
      endsAt: facts.endsAt,
      idempotent: false,
    }
  }

  async function recoverUniqueRace(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutationAuthorization(tx, input)
      assertMutationScope(authorization, platformScope)
      await lockTargetUser(tx, input)
      await lockMembershipChain(tx, input)
      const replay = await findReplay(tx, input)
      if (!replay) throw codeError('CONFLICT')
      return replayResult(replay, input, { codeError, iso })
    })
  }

  async function lockTargetUser(tx, input) {
    const user = await tx.one(
      `SELECT id, status FROM mip_users
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, input.userId],
    )
    if (!user) throw codeError('NOT_FOUND')
    return user
  }

  async function lockMembershipChain(tx, input) {
    const row = await tx.one(
      `SELECT app_id, user_id, version
       FROM mip_membership_chains
       WHERE app_id = ? AND user_id = ? FOR UPDATE`,
      [input.appId, input.userId],
    )
    if (!row || row.app_id !== input.appId || row.user_id !== input.userId) {
      throw codeError('INVALID_STATE')
    }
    return {
      appId: row.app_id,
      userId: row.user_id,
      version: positiveVersion(row.version, codeError),
    }
  }

  function findReplay(db, input) {
    return db.one(
      `SELECT adjustment.id AS adjustment_id, adjustment.user_id,
              adjustment.request_hash, adjustment.result_chain_version,
              entitlement.id AS entitlement_id, entitlement.starts_at,
              entitlement.ends_at
       FROM mip_membership_adjustments adjustment
       LEFT JOIN mip_membership_entitlements entitlement
         ON entitlement.app_id = adjustment.app_id
           AND entitlement.user_id = adjustment.user_id
           AND entitlement.source_type = 'ADMIN_ADJUSTMENT'
           AND entitlement.source_adjustment_id = adjustment.id
       WHERE adjustment.app_id = ? AND adjustment.actor_user_id = ?
         AND adjustment.idempotency_key = ?`,
      [input.appId, input.actorUserId, input.idempotencyKey],
    )
  }

  return { getMembership, grantMembership }
}

function entitlementDto(row, evaluatedAt, dependencies) {
  const { codeError, iso } = dependencies
  if (!entitlementStatuses.has(row.entitlement_status)) throw codeError('INVALID_STATE')
  const startsAt = validDate(row.starts_at, codeError)
  const endsAt = validDate(row.ends_at, codeError)
  if (endsAt.getTime() <= startsAt.getTime()) throw codeError('INVALID_STATE')
  const manual = row.source_type === 'ADMIN_ADJUSTMENT'
  if ((!manual && row.source_type !== 'ORDER')
    || (manual && (row.order_id !== null
      || row.plan_id !== null
      || !row.source_adjustment_id
      || row.adjustment_id !== row.source_adjustment_id))
    || (!manual && (!row.order_id
      || !row.plan_id
      || row.source_adjustment_id !== null
      || row.adjustment_id))) {
    throw codeError('INVALID_STATE')
  }
  const currentlyActive = row.entitlement_status === 'ACTIVE'
    && startsAt.getTime() <= evaluatedAt.getTime()
    && endsAt.getTime() > evaluatedAt.getTime()
  return {
    id: String(row.entitlement_id),
    sourceType: row.source_type,
    status: row.entitlement_status,
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
    currentlyActive,
    orderId: row.order_id || null,
    adjustment: manual ? adjustmentDto(row, { codeError, iso }) : null,
  }
}

function adjustmentDto(row, dependencies) {
  const { codeError, iso } = dependencies
  const duration = Number(row.adjustment_duration_months)
  const expected = positiveVersion(row.expected_chain_version, codeError)
  const result = positiveVersion(row.result_chain_version, codeError)
  if (![1, 3, 6, 12].includes(duration)
    || result !== expected + 1
    || typeof row.adjustment_reason !== 'string'
    || !row.adjustment_reason.trim()
    || row.adjustment_reason.length > 300) {
    throw codeError('INVALID_STATE')
  }
  return {
    id: String(row.adjustment_id),
    durationMonths: duration,
    reason: row.adjustment_reason,
    actorNickname: displayName(row.actor_nickname),
    createdAt: iso(validDate(row.adjustment_created_at, codeError)),
    expectedChainVersion: expected,
    resultChainVersion: result,
  }
}

function membershipSummary(entitlements, evaluatedAt) {
  const evaluatedAtMs = evaluatedAt.getTime()
  const active = entitlements.filter(item => item.currentlyActive)
  const scheduled = entitlements.filter(item => item.status === 'ACTIVE'
    && !item.currentlyActive
    && Date.parse(item.startsAt) > evaluatedAtMs)
  const currentEndsAt = active.reduce((latest, item) => {
    if (!latest || Date.parse(item.endsAt) > Date.parse(latest)) return item.endsAt
    return latest
  }, null)
  const nextStartsAt = scheduled.reduce((earliest, item) => {
    if (!earliest || Date.parse(item.startsAt) < Date.parse(earliest)) return item.startsAt
    return earliest
  }, null)
  return {
    status: active.length ? 'ACTIVE' : (scheduled.length ? 'SCHEDULED' : 'INACTIVE'),
    active: active.length > 0,
    currentEndsAt,
    nextStartsAt,
  }
}

function replayResult(row, input, dependencies) {
  const { codeError, iso } = dependencies
  if (row.request_hash !== input.requestHash) throw codeError('IDEMPOTENCY_CONFLICT')
  if (!row.entitlement_id || row.user_id !== input.userId) throw codeError('INVALID_STATE')
  const resultChainVersion = positiveVersion(row.result_chain_version, codeError)
  const startsAt = validDate(row.starts_at, codeError)
  const endsAt = validDate(row.ends_at, codeError)
  if (endsAt.getTime() <= startsAt.getTime()) throw codeError('INVALID_STATE')
  return {
    adjustmentId: String(row.adjustment_id),
    resultChainVersion,
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
    idempotent: true,
  }
}

function membershipWindowStart(entitlements, currentTime, codeError) {
  let start = validDate(currentTime, codeError)
  for (const entitlement of entitlements) {
    if (entitlement.status === 'REFUNDED') continue
    if (!entitlementStatuses.has(entitlement.status)) throw codeError('INVALID_STATE')
    const startsAt = validDate(entitlement.starts_at, codeError)
    const endsAt = validDate(entitlement.ends_at, codeError)
    if (endsAt.getTime() <= startsAt.getTime()) throw codeError('INVALID_STATE')
    if (endsAt.getTime() > start.getTime()) start = endsAt
  }
  return new Date(start)
}

function addUtcCalendarMonths(start, months, codeError = defaultCodeError) {
  const source = validDate(start, codeError)
  const firstOfTarget = new Date(Date.UTC(
    source.getUTCFullYear(),
    source.getUTCMonth() + months,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  ))
  const lastDay = new Date(Date.UTC(
    firstOfTarget.getUTCFullYear(),
    firstOfTarget.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  firstOfTarget.setUTCDate(Math.min(source.getUTCDate(), lastDay))
  return firstOfTarget
}

function positiveVersion(value, codeError) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw codeError('INVALID_STATE')
  return parsed
}

function validDate(value, codeError) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw codeError('INVALID_STATE')
  return date
}

function displayName(value) {
  return typeof value === 'string' && value.trim() ? value : '未填写昵称'
}

function defaultIso(value) {
  return value.toISOString()
}

function defaultDuplicateConstraint(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function defaultCodeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createMembershipRepository }
