'use strict'

const { randomUUID } = require('node:crypto')
const { lockActiveContributor } = require('../lib/auth')
const { createProfileRef } = require('../lib/profile-ref')
const { appendAudit, appendOutbox, decodeCursor, encodeCursor, idempotentTransaction, jsonObject, mutualBlockFilter, uuid } = require('./common')
const { canBrowsePlatformOpportunities, opportunityVisibility } = require('./journey-access')

async function visibleOpportunity(database, caller, id, lock = false) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  if (!uuid(id)) throw new Error('VALIDATION_FAILED')
  const privacy = opportunityVisibility(caller)
  const block = mutualBlockFilter(caller.userId, 'o.owner_user_id', 'o.app_id')
  const row = await database.one(`SELECT o.id, o.owner_user_id, o.status FROM mip_opportunities o
    JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.owner_user_id
    JOIN mip_users owner ON owner.app_id = o.app_id AND owner.id = o.owner_user_id AND owner.status = 'ACTIVE'
    WHERE o.app_id = ? AND o.id = ? AND o.status IN ('PUBLISHED', 'ENDED')
      AND ${privacy.sql} AND ${block.sql} ${lock ? 'FOR UPDATE' : ''}`,
  [caller.appId, id, ...privacy.params, ...block.params])
  if (!row) throw new Error('NOT_FOUND')
  if (row.owner_user_id !== caller.userId && !await canBrowsePlatformOpportunities(database, caller)) throw new Error('FORBIDDEN')
  return row
}

// One visibility predicate is shared by counts, avatar previews and the full list.
function visibleMembers(caller, ids) {
  const block = mutualBlockFilter(caller.userId, 'member.id', 'member.app_id')
  return {
    sql: `FROM mip_opportunity_cooperations intent
      JOIN mip_users member ON member.app_id = intent.app_id AND member.id = intent.user_id AND member.status = 'ACTIVE'
      JOIN mip_profiles profile ON profile.app_id = member.app_id AND profile.user_id = member.id
      LEFT JOIN mip_media_assets avatar ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id AND avatar.status = 'READY'
      WHERE intent.app_id = ? AND intent.opportunity_id IN (${ids.map(() => '?').join(',')}) AND intent.status = 'ACTIVE'
      ${block.sql ? `AND ${block.sql}` : ''}`,
    params: [caller.appId, ...ids, ...block.params],
  }
}

function memberDto(row, caller) {
  const visibility = jsonObject(row.visibility_json)
  return {
    profileRef: createProfileRef({ appId: caller.appId, userId: row.user_id }, caller.profileRefSecret),
    nickname: visibility.nickname === false ? 'MIP 用户' : row.nickname || 'MIP 用户',
    avatarUrl: visibility.avatar === false ? undefined : row.avatar_file_id || undefined,
    headline: visibility.headline === false ? undefined : row.headline || undefined,
  }
}

async function cooperationSummaries(database, caller, ids) {
  const result = new Map()
  if (!ids.length || !caller.userId) return result
  const members = visibleMembers(caller, ids)
  const rows = await database.query(`SELECT * FROM (
    SELECT intent.opportunity_id, intent.user_id, profile.nickname, profile.headline, profile.visibility_json,
      avatar.cloud_file_id AS avatar_file_id,
      COUNT(*) OVER (PARTITION BY intent.opportunity_id) AS cooperation_count,
      ROW_NUMBER() OVER (PARTITION BY intent.opportunity_id ORDER BY intent.activated_at DESC, intent.id DESC) AS position
    ${members.sql}) previews WHERE position <= 3`, members.params)
  for (const row of rows) {
    const summary = result.get(row.opportunity_id) || { count: Number(row.cooperation_count), avatars: [] }
    const member = memberDto(row, caller)
    if (member.avatarUrl) summary.avatars.push(member.avatarUrl)
    result.set(row.opportunity_id, summary)
  }
  return result
}

async function listOpportunityCooperators(database, caller, input) {
  await visibleOpportunity(database, caller, input.id)
  const size = Math.min(30, Math.max(1, Number.isInteger(input.limit) ? input.limit : 20))
  const cursor = decodeCursor(input.cursor)
  const members = visibleMembers(caller, [input.id])
  const rows = await database.query(`SELECT intent.id, intent.activated_at, intent.user_id,
    profile.nickname, profile.headline, profile.visibility_json, avatar.cloud_file_id AS avatar_file_id
    ${members.sql}
    ${cursor ? 'AND (intent.activated_at < ? OR (intent.activated_at = ? AND intent.id < ?))' : ''}
    ORDER BY intent.activated_at DESC, intent.id DESC LIMIT ?`,
  [...members.params, ...(cursor ? [new Date(cursor.timestamp), new Date(cursor.timestamp), cursor.id] : []), size + 1])
  const page = rows.slice(0, size)
  return { items: page.map(row => memberDto(row, caller)), nextCursor: rows.length > size ? encodeCursor(page.at(-1).activated_at, page.at(-1).id) : undefined }
}

async function setOpportunityCooperation(database, caller, input) {
  if (!uuid(input.id) || typeof input.active !== 'boolean') throw new Error('VALIDATION_FAILED')
  return idempotentTransaction(database, {
    appId: caller.appId, userId: caller.userId, operation: 'opportunity.cooperation',
    idempotencyKey: input.idempotencyKey, request: { id: input.id, active: input.active },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const opportunity = await visibleOpportunity(tx, caller, input.id, true)
    if (opportunity.owner_user_id === caller.userId) throw new Error('CONFLICT')
    if (input.active && opportunity.status !== 'PUBLISHED') throw new Error('CONFLICT')
    const stored = await tx.one(`SELECT id, status, version FROM mip_opportunity_cooperations
      WHERE app_id = ? AND opportunity_id = ? AND user_id = ? FOR UPDATE`, [caller.appId, input.id, caller.userId])
    const status = input.active ? 'ACTIVE' : 'CANCELLED'
    if (stored?.status === status || (!stored && !input.active)) return { active: input.active, version: Number(stored?.version || 0) }
    const id = stored?.id || randomUUID()
    const version = Number(stored?.version || 0) + 1
    if (stored) {
      await tx.query(`UPDATE mip_opportunity_cooperations SET status = ?, version = version + 1,
        activated_at = CASE WHEN ? = 'ACTIVE' THEN UTC_TIMESTAMP(3) ELSE activated_at END
        WHERE app_id = ? AND id = ?`, [status, status, caller.appId, id])
    }
    else {
      await tx.query(`INSERT INTO mip_opportunity_cooperations (app_id, id, opportunity_id, user_id)
        VALUES (?, ?, ?, ?)`, [caller.appId, id, input.id, caller.userId])
    }
    await appendOutbox(tx, { appId: caller.appId, aggregateType: 'OPPORTUNITY_COOPERATION', aggregateId: id,
      eventType: 'opportunity.cooperation_changed', sourceVersion: version, payload: { opportunityId: input.id, active: input.active } })
    await appendAudit(tx, { appId: caller.appId, actorUserId: caller.userId, action: input.active ? 'COOPERATION_ACTIVATED' : 'COOPERATION_CANCELLED',
      resourceType: 'OPPORTUNITY_COOPERATION', resourceId: id, metadata: { opportunityId: input.id, version } })
    return { active: input.active, version }
  })
}

module.exports = { cooperationSummaries, listOpportunityCooperators, setOpportunityCooperation }
