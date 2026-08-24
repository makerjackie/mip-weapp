'use strict'

const { randomUUID } = require('node:crypto')

const GAME_COIN_EVENTS = Object.freeze({
  'game.match_won': Object.freeze({
    action: 'grantGameCoins',
    delta: 10,
    label: '每周赛胜方奖励',
  }),
  'game.reward_redeemed': Object.freeze({
    action: 'spendGameCoins',
    delta: -5,
    label: '游戏奖励兑换',
  }),
})

function createGameCoinRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function recordGameCoinEvent(input) {
    validateInput(input)
    const rule = GAME_COIN_EVENTS[input.sourceEventType]
    if (!rule || rule.action !== input.action) throw new Error('GAME_COIN_RULE_NOT_AVAILABLE')

    return database.transaction(async (tx) => {
      const user = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')

      const existing = await tx.one(
        `SELECT id, delta_value, balance_after, created_at
         FROM mip_growth_entries
         WHERE app_id = ? AND user_id = ? AND source_event_type = ?
           AND source_event_id = ? AND metric = 'COIN'
         FOR UPDATE`,
        [input.appId, input.userId, input.sourceEventType, input.sourceEventId],
      )
      if (existing) {
        if (Math.sign(Number(existing.delta_value)) !== Math.sign(rule.delta)) {
          throw new Error('IDEMPOTENCY_CONFLICT')
        }
        return resultDto(existing, input.sourceEventType, true)
      }

      await tx.query(
        `INSERT INTO mip_growth_accounts (app_id, user_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [input.appId, input.userId],
      )
      const account = await tx.one(
        `SELECT coin_balance, version FROM mip_growth_accounts
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      const balanceAfter = Number(account.coin_balance) + rule.delta
      if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
        throw new Error('INSUFFICIENT_GAME_COIN_BALANCE')
      }
      const update = await tx.query(
        `UPDATE mip_growth_accounts SET coin_balance = ?, version = version + 1
         WHERE app_id = ? AND user_id = ? AND version = ?`,
        [balanceAfter, input.appId, input.userId, account.version],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')

      const entryId = createId()
      await tx.query(
        `INSERT INTO mip_growth_entries (
           id, app_id, user_id, rule_id, source_event_id, source_event_type,
           metric, delta_value, balance_after, adjustment_reason, actor_user_id
         ) VALUES (?, ?, ?, NULL, ?, ?, 'COIN', ?, ?, ?, NULL)`,
        [entryId, input.appId, input.userId, input.sourceEventId,
          input.sourceEventType, rule.delta, balanceAfter, rule.label],
      )
      await tx.query(
        `INSERT INTO mip_outbox_events (
           id, app_id, aggregate_type, aggregate_id, event_type,
           source_version, payload_json, status
         ) VALUES (?, ?, 'GROWTH_ENTRY', ?, 'game.coin_changed', ?, JSON_OBJECT(), 'PENDING')`,
        [createId(), input.appId, entryId, Number(account.version) + 1],
      )
      return {
        entryId,
        sourceEventType: input.sourceEventType,
        deltaValue: rule.delta,
        balanceAfter,
        idempotent: false,
      }
    })
  }

  return { recordGameCoinEvent }
}

function resultDto(row, sourceEventType, idempotent) {
  return {
    entryId: row.id,
    sourceEventType,
    deltaValue: Number(row.delta_value),
    balanceAfter: Number(row.balance_after),
    idempotent,
  }
}

function validateInput(input) {
  if (!input || !['grantGameCoins', 'spendGameCoins'].includes(input.action)
    || !isUuid(input.userId) || !isUuid(input.sourceEventId)
    || !/^[a-z][a-z0-9_.-]{2,79}$/.test(String(input.sourceEventType || ''))) {
    throw new Error('VALIDATION_FAILED')
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = { GAME_COIN_EVENTS, createGameCoinRepository, validateInput }
