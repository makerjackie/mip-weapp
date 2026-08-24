'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { createCheckInGrowthRepository } = require('./checkin-compensation')
const { levelSnapshot, projectAward } = require('./rules')

function createGrowthRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const checkInGrowthRepository = createCheckInGrowthRepository(database, { createId })

  async function getSnapshot(appId, userId) {
    await ensureAccount(database, appId, userId)
    const [account, rawLevels, levelBenefits, rules] = await Promise.all([
      database.one(
        `SELECT user_id, experience_balance, contribution_balance, version
         FROM mip_growth_accounts WHERE app_id = ? AND user_id = ?`,
        [appId, userId],
      ),
      database.query(
        `SELECT id, level_key, name, minimum_experience, benefits_json, status
         FROM mip_growth_levels
         WHERE app_id = ? AND status = 'ACTIVE'
         ORDER BY minimum_experience, id`,
        [appId],
      ),
      database.query(
        `SELECT relation.level_id, benefit.name, benefit.status
         FROM mip_growth_level_benefits relation
         INNER JOIN mip_growth_benefits benefit
           ON benefit.app_id = relation.app_id AND benefit.id = relation.benefit_id
         WHERE relation.app_id = ?
         ORDER BY relation.level_id, relation.sort_order, benefit.sort_order, benefit.id`,
        [appId],
      ),
      database.query(
        `SELECT id, rule_key, name, metric, delta_value, daily_limit_value,
                source_event_type, status
         FROM mip_growth_rules
         WHERE app_id = ? AND status = 'ACTIVE'
           AND metric IN ('EXPERIENCE', 'CONTRIBUTION')
         ORDER BY metric, name, id`,
        [appId],
      ),
    ])
    const benefitsByLevel = new Map()
    for (const benefit of levelBenefits) {
      const group = benefitsByLevel.get(benefit.level_id) || []
      group.push(benefit)
      benefitsByLevel.set(benefit.level_id, group)
    }
    const levels = rawLevels.map((level) => {
      const related = benefitsByLevel.get(level.id)
      return {
        ...level,
        benefits_json: related
          ? JSON.stringify(related.filter(item => item.status === 'ACTIVE').map(item => item.name))
          : level.benefits_json,
      }
    })
    return levelSnapshot(account, levels, rules)
  }

  async function listEntries(appId, userId, options = {}) {
    const limit = Math.min(30, Math.max(1, Number(options.limit) || 20))
    const cursor = decodeCursor(options.cursor)
    const params = [appId, userId]
    let cursorSql = ''
    if (cursor) {
      cursorSql = 'AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))'
      params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }
    params.push(limit + 1)
    const rows = await database.query(
      `SELECT e.id, e.source_event_type, e.metric, e.delta_value, e.balance_after,
              e.created_at, r.rule_key, r.name AS rule_name
       FROM mip_growth_entries e
       LEFT JOIN mip_growth_rules r ON r.app_id = e.app_id AND r.id = e.rule_id
       WHERE e.app_id = ? AND e.user_id = ?
         AND e.metric IN ('EXPERIENCE', 'CONTRIBUTION') ${cursorSql}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ?`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      items: page.map(entryDto),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function recordConfirmedEvent(input) {
    validateConfirmedEvent(input)
    const idempotencyKey = `${input.sourceEventType}:${input.sourceEventId}`
    const requestHash = createHash('sha256')
      .update(`${input.appId}\0${input.userId}\0${idempotencyKey}`)
      .digest('hex')
    return database.transaction(async (tx) => {
      const prior = await tx.one(
        `SELECT request_hash, status, response_json
         FROM mip_idempotency_keys
         WHERE app_id = ? AND actor_user_id = ? AND operation = 'growth.record'
           AND idempotency_key = ? FOR UPDATE`,
        [input.appId, input.userId, idempotencyKey],
      )
      if (prior) {
        if (prior.request_hash !== requestHash) {
          throw new Error('IDEMPOTENCY_CONFLICT')
        }
        if (prior.status === 'COMPLETED') {
          return sanitizeRecordResponse(parseObject(prior.response_json))
        }
        throw new Error('CONFLICT')
      }

      const user = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('FORBIDDEN')
      }
      await tx.query(
        `INSERT INTO mip_idempotency_keys (
           id, app_id, actor_user_id, operation, idempotency_key,
           request_hash, status, expires_at
         ) VALUES (?, ?, ?, 'growth.record', ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 YEAR))`,
        [createId(), input.appId, input.userId, idempotencyKey, requestHash],
      )
      await tx.query(
        `INSERT INTO mip_growth_accounts (app_id, user_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [input.appId, input.userId],
      )
      const account = await tx.one(
        `SELECT user_id, experience_balance, contribution_balance, version
         FROM mip_growth_accounts WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      const rules = await tx.query(
        `SELECT id, rule_key, name, metric, delta_value, daily_limit_value,
                source_event_type, status
         FROM mip_growth_rules
         WHERE app_id = ? AND source_event_type = ? AND status = 'ACTIVE'
           AND metric IN ('EXPERIENCE', 'CONTRIBUTION')
         ORDER BY id FOR UPDATE`,
        [input.appId, input.sourceEventType],
      )
      if (new Set(rules.map(rule => rule.metric)).size !== rules.length) {
        throw new Error('GROWTH_RULE_CONFLICT')
      }
      const awards = []
      for (const rule of rules) {
        const existing = await tx.one(
          `SELECT id, metric, delta_value, balance_after, created_at
           FROM mip_growth_entries
           WHERE app_id = ? AND user_id = ? AND source_event_type = ?
             AND source_event_id = ? AND metric = ?`,
          [input.appId, input.userId, input.sourceEventType, input.sourceEventId, rule.metric],
        )
        if (existing) {
          awards.push({
            id: existing.id,
            ruleKey: rule.rule_key,
            metric: existing.metric,
            requestedDelta: Number(existing.delta_value),
            appliedDelta: Number(existing.delta_value),
            balanceAfter: Number(existing.balance_after),
            capped: false,
            idempotent: true,
          })
          continue
        }
        const daily = await tx.one(
          `SELECT COALESCE(SUM(GREATEST(delta_value, 0)), 0) AS total
           FROM mip_growth_entries
           WHERE app_id = ? AND user_id = ? AND rule_id = ?
             AND created_at >= UTC_DATE() AND created_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)`,
          [input.appId, input.userId, rule.id],
        )
        const projection = projectAward(account, rule, Number(daily?.total || 0))
        if (projection.applied === 0) {
          awards.push({
            ruleKey: rule.rule_key,
            metric: rule.metric,
            requestedDelta: projection.requested,
            appliedDelta: 0,
            balanceAfter: projection.balanceAfter,
            capped: true,
          })
          continue
        }
        const field = projection.field
        await tx.query(
          `UPDATE mip_growth_accounts SET ${field} = ?, version = version + 1
           WHERE app_id = ? AND user_id = ?`,
          [projection.balanceAfter, input.appId, input.userId],
        )
        account[field] = projection.balanceAfter
        account.version = Number(account.version) + 1
        const entryId = createId()
        await tx.query(
          `INSERT INTO mip_growth_entries (
             id, app_id, user_id, rule_id, source_event_id, source_event_type,
             metric, delta_value, balance_after, adjustment_reason, actor_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
          [
            entryId,
            input.appId,
            input.userId,
            rule.id,
            input.sourceEventId,
            input.sourceEventType,
            rule.metric,
            projection.applied,
            projection.balanceAfter,
          ],
        )
        await tx.query(
          `INSERT INTO mip_outbox_events (
             id, app_id, aggregate_type, aggregate_id, event_type,
             source_version, payload_json, status
           ) VALUES (?, ?, 'GROWTH_ENTRY', ?, 'growth.changed', ?, JSON_OBJECT(), 'PENDING')`,
          [createId(), input.appId, entryId, account.version],
        )
        awards.push({
          id: entryId,
          ruleKey: rule.rule_key,
          metric: rule.metric,
          requestedDelta: projection.requested,
          appliedDelta: projection.applied,
          balanceAfter: projection.balanceAfter,
          capped: projection.capped,
          idempotent: false,
        })
      }
      const response = { sourceEventId: input.sourceEventId, awards }
      await tx.query(
        `UPDATE mip_idempotency_keys
         SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND actor_user_id = ? AND operation = 'growth.record'
           AND idempotency_key = ?`,
        [JSON.stringify(response), input.appId, input.userId, idempotencyKey],
      )
      return response
    })
  }

  async function listBadgeCollection(appId, userId) {
    await database.query(
      `INSERT INTO mip_user_badge_profiles (app_id, user_id)
       VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [appId, userId],
    )
    const [profile, rows] = await Promise.all([
      database.one(
        `SELECT version FROM mip_user_badge_profiles WHERE app_id = ? AND user_id = ?`,
        [appId, userId],
      ),
      database.query(
        `SELECT badge.id, badge.badge_key, badge.name, badge.description, badge.icon_name,
                badge.image_url, badge.placeholder_shape, badge.sort_order, badge.status,
                award.awarded_at, equipment.slot_no
         FROM mip_user_badges award
         INNER JOIN mip_badges badge
           ON badge.app_id = award.app_id AND badge.id = award.badge_id
         LEFT JOIN mip_user_badge_equipment equipment
           ON equipment.app_id = award.app_id AND equipment.user_id = award.user_id
             AND equipment.badge_id = award.badge_id
         WHERE award.app_id = ? AND award.user_id = ? AND award.status = 'ACTIVE'
         ORDER BY equipment.slot_no IS NULL, equipment.slot_no, badge.sort_order, award.awarded_at, badge.id`,
        [appId, userId],
      ),
    ])
    return badgeCollectionDto(profile, rows)
  }

  async function equipBadges(appId, userId, input = {}) {
    const expectedVersion = Number(input.expectedVersion)
    const badgeIds = Array.isArray(input.badgeIds)
      ? [...new Set(input.badgeIds.map(value => String(value || '').trim()).filter(Boolean))]
      : []
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1
      || badgeIds.length > 3 || badgeIds.some(value => !isUuid(value))) {
      throw new Error('BADGE_EQUIPMENT_INVALID')
    }
    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO mip_user_badge_profiles (app_id, user_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [appId, userId],
      )
      const profile = await tx.one(
        `SELECT version FROM mip_user_badge_profiles
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [appId, userId],
      )
      if (Number(profile?.version) !== expectedVersion) throw new Error('CONFLICT')
      if (badgeIds.length) {
        const rows = await tx.query(
          `SELECT award.badge_id
           FROM mip_user_badges award
           INNER JOIN mip_badges badge
             ON badge.app_id = award.app_id AND badge.id = award.badge_id
           WHERE award.app_id = ? AND award.user_id = ?
             AND award.badge_id IN (${badgeIds.map(() => '?').join(', ')})
             AND award.status = 'ACTIVE' AND badge.status = 'ACTIVE'
           FOR UPDATE`,
          [appId, userId, ...badgeIds],
        )
        if (rows.length !== badgeIds.length) throw new Error('BADGE_EQUIPMENT_INVALID')
      }
      await tx.query(
        'DELETE FROM mip_user_badge_equipment WHERE app_id = ? AND user_id = ?',
        [appId, userId],
      )
      for (const [index, badgeId] of badgeIds.entries()) {
        await tx.query(
          `INSERT INTO mip_user_badge_equipment (app_id, user_id, slot_no, badge_id)
           VALUES (?, ?, ?, ?)`,
          [appId, userId, index + 1, badgeId],
        )
      }
      const result = await tx.query(
        `UPDATE mip_user_badge_profiles SET version = version + 1
         WHERE app_id = ? AND user_id = ? AND version = ?`,
        [appId, userId, expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
    })
    return listBadgeCollection(appId, userId)
  }

  return {
    ...checkInGrowthRepository,
    equipBadges,
    getSnapshot,
    listBadgeCollection,
    listEntries,
    recordConfirmedEvent,
  }
}

function badgeCollectionDto(profile, rows) {
  return {
    version: Number(profile?.version || 1),
    maximumEquipped: 3,
    items: rows.map(row => ({
      id: row.id,
      key: row.badge_key,
      name: row.name,
      description: row.description,
      iconName: row.icon_name || undefined,
      imageUrl: row.image_url || undefined,
      placeholderShape: row.placeholder_shape,
      status: row.status,
      equippedSlot: row.slot_no === null || row.slot_no === undefined ? undefined : Number(row.slot_no),
      awardedAt: iso(row.awarded_at),
    })),
  }
}

async function ensureAccount(database, appId, userId) {
  await database.query(
    `INSERT INTO mip_growth_accounts (app_id, user_id)
     VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [appId, userId],
  )
}

function entryDto(row) {
  if (row.metric !== 'EXPERIENCE' && row.metric !== 'CONTRIBUTION') {
    throw new Error('GROWTH_RULE_NOT_AVAILABLE')
  }
  return {
    id: row.id,
    ruleKey: row.rule_key || undefined,
    ruleName: row.rule_name || undefined,
    sourceEventType: row.source_event_type,
    metric: row.metric,
    deltaValue: Number(row.delta_value),
    balanceAfter: Number(row.balance_after),
    createdAt: iso(row.created_at),
  }
}

function sanitizeRecordResponse(value) {
  return {
    ...value,
    awards: Array.isArray(value.awards)
      ? value.awards.filter(award => award?.metric === 'EXPERIENCE' || award?.metric === 'CONTRIBUTION')
      : [],
  }
}

function validateConfirmedEvent(input) {
  if (!isUuid(input.userId) || !isUuid(input.sourceEventId)
    || !/^[a-z][a-z0-9_.-]{2,79}$/.test(input.sourceEventType)) {
    throw new Error('VALIDATION_FAILED')
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function encodeCursor(row) {
  if (!row) return undefined
  return Buffer.from(JSON.stringify({ createdAt: iso(row.created_at), id: row.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const result = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!isUuid(result.id) || !Number.isFinite(Date.parse(result.createdAt))) {
      throw new Error('VALIDATION_FAILED')
    }
    return result
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

function parseObject(value) {
  if (value && typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

module.exports = {
  badgeCollectionDto,
  createGrowthRepository,
  decodeCursor,
  encodeCursor,
  entryDto,
  validateConfirmedEvent,
}
