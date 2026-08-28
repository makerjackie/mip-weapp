'use strict'

const { randomInt, randomUUID } = require('node:crypto')
const { gameAdminMutation } = require('./admin-idempotency')
const { boundedText, expectedVersion, optionalId, requiredId } = require('./validation')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const RARITIES = Object.freeze(['COMMON', 'RARE', 'EPIC', 'LEGENDARY'])
const RARITY_LABELS = Object.freeze({
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
})
const DEFAULT_WEIGHTS = Object.freeze({ COMMON: 7000, RARE: 2200, EPIC: 700, LEGENDARY: 100 })

function createBlindBoxRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const createIdempotencyId = options.createIdempotencyId || randomUUID
  const secureRandomInt = options.randomInt || randomInt
  const assertAdmin = options.assertAdmin

  function runAdminMutation(caller, event, operation, request, work) {
    return gameAdminMutation(database, {
      caller,
      operation,
      idempotencyKey: event.idempotencyKey,
      request,
      createId: createIdempotencyId,
      authorize: tx => requireAdmin(tx, caller, true),
      work,
    })
  }

  async function listBlindBoxes(caller) {
    const rows = await database.query(
      `SELECT catalog.*,
              COUNT(card.id) AS card_count,
              COALESCE(SUM(card.stock_remaining), 0) AS stock_remaining
       FROM mip_blind_box_catalogs catalog
       LEFT JOIN mip_blind_box_cards card
         ON card.app_id = catalog.app_id AND card.catalog_id = catalog.id
        AND card.status = 'PUBLISHED'
       WHERE catalog.app_id = ? AND catalog.status = 'PUBLISHED'
       GROUP BY catalog.app_id, catalog.id
       ORDER BY catalog.updated_at DESC, catalog.id`,
      [caller.appId],
    )
    const account = await database.one(
      `SELECT coin_balance FROM mip_growth_accounts WHERE app_id = ? AND user_id = ?`,
      [caller.appId, caller.userId],
    )
    return { coinBalance: Number(account?.coin_balance || 0), items: rows.map(catalogSummaryDto) }
  }

  async function getBlindBox(caller, event = {}) {
    const catalogId = requiredId(event.catalogId)
    const catalog = await database.one(
      `SELECT catalog.*,
              COUNT(card.id) AS card_count,
              COALESCE(SUM(card.stock_remaining), 0) AS stock_remaining
       FROM mip_blind_box_catalogs catalog
       LEFT JOIN mip_blind_box_cards card
         ON card.app_id = catalog.app_id AND card.catalog_id = catalog.id
        AND card.status = 'PUBLISHED'
       WHERE catalog.app_id = ? AND catalog.id = ? AND catalog.status = 'PUBLISHED'
       GROUP BY catalog.app_id, catalog.id`,
      [caller.appId, catalogId],
    )
    if (!catalog) throw new Error('NOT_FOUND')
    const cards = await database.query(
      `SELECT id, name, summary, rarity, weight, stock_remaining, status
       FROM mip_blind_box_cards
       WHERE app_id = ? AND catalog_id = ? AND status = 'PUBLISHED'
       ORDER BY display_order, name, id`,
      [caller.appId, catalogId],
    )
    return {
      ...catalogSummaryDto(catalog),
      rulesText: catalog.rules_text,
      redemptionRulesText: catalog.redemption_rules_text,
      rarities: rarityBreakdown(cards),
      cards: cards.map(publicCardDto),
    }
  }

  async function getBlindBoxInventory(caller, event = {}) {
    const catalogId = optionalId(event.catalogId)
    const params = [caller.appId, caller.userId]
    const catalogSql = catalogId ? 'AND card.catalog_id = ?' : ''
    if (catalogId) params.push(catalogId)
    const rows = await database.query(
      `SELECT card.id AS card_id, card.catalog_id, catalog.name AS catalog_name,
              card.name, card.summary, card.rarity, card.status,
              COALESCE(inventory.quantity, 0) AS quantity,
              inventory.first_acquired_at, inventory.last_acquired_at
       FROM mip_blind_box_cards card
       INNER JOIN mip_blind_box_catalogs catalog
         ON catalog.app_id = card.app_id AND catalog.id = card.catalog_id
        AND catalog.status <> 'DRAFT'
       LEFT JOIN mip_blind_box_inventory inventory
         ON inventory.app_id = card.app_id AND inventory.card_id = card.id
        AND inventory.user_id = ?
       WHERE card.app_id = ? AND card.status <> 'DRAFT' ${catalogSql}
       ORDER BY catalog.updated_at DESC, card.display_order, card.name, card.id`,
      [caller.userId, caller.appId, ...(catalogId ? [catalogId] : [])],
    )
    return { items: rows.map(inventoryDto) }
  }

  async function listBlindBoxCoinEntries(caller, event = {}) {
    const limit = normalizeLimit(event.limit, 50)
    const rows = await database.query(
      `SELECT id, delta_value, balance_after, adjustment_reason, created_at
       FROM mip_growth_entries
       WHERE app_id = ? AND user_id = ? AND metric = 'COIN'
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [caller.appId, caller.userId, limit],
    )
    const account = await database.one(
      `SELECT coin_balance FROM mip_growth_accounts WHERE app_id = ? AND user_id = ?`,
      [caller.appId, caller.userId],
    )
    return {
      coinBalance: Number(account?.coin_balance || 0),
      items: rows.map(row => ({
        id: row.id,
        deltaValue: Number(row.delta_value),
        balanceAfter: Number(row.balance_after),
        reason: row.adjustment_reason || '盲盒抽取',
        createdAt: iso(row.created_at),
      })),
    }
  }

  async function drawBlindBox(caller, event = {}) {
    if (Object.keys(event).some(key => !['action', 'catalogId', 'requestId'].includes(key))) {
      throw new Error('VALIDATION_FAILED')
    }
    const catalogId = requiredId(event.catalogId)
    const requestId = requiredId(event.requestId)
    return database.transaction(async (tx) => {
      const user = await tx.one(
        `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, caller.userId],
      )
      if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
      const entitlement = await tx.one(
        `SELECT id FROM mip_membership_entitlements
         WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
           AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
         ORDER BY ends_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [caller.appId, caller.userId],
      )
      if (!entitlement) throw new Error('MEMBERSHIP_REQUIRED')

      const existing = await findDraw(tx, caller.appId, caller.userId, requestId)
      if (existing) {
        if (existing.catalog_id !== catalogId) throw new Error('IDEMPOTENCY_CONFLICT')
        return drawDto(existing, true)
      }

      const catalog = await tx.one(
        `SELECT * FROM mip_blind_box_catalogs
         WHERE app_id = ? AND id = ? AND status = 'PUBLISHED' FOR UPDATE`,
        [caller.appId, catalogId],
      )
      if (!catalog) throw new Error('NOT_FOUND')
      const daily = await tx.one(
        `SELECT COUNT(*) AS draw_count FROM mip_blind_box_draws
         WHERE app_id = ? AND user_id = ? AND catalog_id = ?
           AND created_at >= UTC_DATE()`,
        [caller.appId, caller.userId, catalogId],
      )
      if (Number(daily?.draw_count || 0) >= Number(catalog.daily_draw_limit)) {
        throw new Error('BLIND_BOX_DAILY_LIMIT_REACHED')
      }

      await tx.query(
        `INSERT INTO mip_blind_box_user_states (app_id, user_id, catalog_id)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE catalog_id = VALUES(catalog_id)`,
        [caller.appId, caller.userId, catalogId],
      )
      const state = await tx.one(
        `SELECT draw_count, pity_count, version FROM mip_blind_box_user_states
         WHERE app_id = ? AND user_id = ? AND catalog_id = ? FOR UPDATE`,
        [caller.appId, caller.userId, catalogId],
      )
      const pityBefore = Number(state.pity_count)
      const pityTriggered = pityBefore + 1 >= Number(catalog.pity_threshold)
      const cards = await tx.query(
        `SELECT id, name, summary, rarity, weight, stock_remaining
         FROM mip_blind_box_cards
         WHERE app_id = ? AND catalog_id = ? AND status = 'PUBLISHED'
           AND stock_remaining > 0
         ORDER BY id FOR UPDATE`,
        [caller.appId, catalogId],
      )
      const candidates = pityTriggered
        ? cards.filter(card => rarityRank(card.rarity) >= rarityRank(catalog.pity_min_rarity))
        : cards
      if (!candidates.length) {
        throw new Error(pityTriggered ? 'BLIND_BOX_PITY_STOCK_UNAVAILABLE' : 'BLIND_BOX_STOCK_UNAVAILABLE')
      }
      const selection = selectWeightedCard(candidates, secureRandomInt)
      const selected = selection.card

      await tx.query(
        `INSERT INTO mip_growth_accounts (app_id, user_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [caller.appId, caller.userId],
      )
      const account = await tx.one(
        `SELECT coin_balance, version FROM mip_growth_accounts
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [caller.appId, caller.userId],
      )
      const costCoin = Number(catalog.draw_cost_coin)
      const balanceAfter = Number(account.coin_balance) - costCoin
      if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
        throw new Error('INSUFFICIENT_GAME_COIN_BALANCE')
      }
      const accountUpdate = await tx.query(
        `UPDATE mip_growth_accounts SET coin_balance = ?, version = version + 1
         WHERE app_id = ? AND user_id = ? AND version = ?`,
        [balanceAfter, caller.appId, caller.userId, account.version],
      )
      assertAffected(accountUpdate)
      const cardUpdate = await tx.query(
        `UPDATE mip_blind_box_cards SET stock_remaining = stock_remaining - 1
         WHERE app_id = ? AND id = ? AND stock_remaining > 0`,
        [caller.appId, selected.id],
      )
      assertAffected(cardUpdate)
      await assertPublishedCatalogInvariant(tx, caller.appId, catalog)

      const drawId = createId()
      const coinEntryId = createId()
      const outboxEventId = createId()
      const nextPity = rarityRank(selected.rarity) >= rarityRank(catalog.pity_min_rarity)
        ? 0
        : pityBefore + 1
      await tx.query(
        `INSERT INTO mip_growth_entries (
           id, app_id, user_id, rule_id, source_event_id, source_event_type,
           metric, delta_value, balance_after, adjustment_reason, actor_user_id
         ) VALUES (?, ?, ?, NULL, ?, 'game.blind_box_draw', 'COIN', ?, ?, ?, NULL)`,
        [coinEntryId, caller.appId, caller.userId, drawId, -costCoin, balanceAfter, `${catalog.name}抽取`],
      )
      const stateUpdate = await tx.query(
        `UPDATE mip_blind_box_user_states
         SET draw_count = draw_count + 1, pity_count = ?, last_draw_at = UTC_TIMESTAMP(3),
             version = version + 1
         WHERE app_id = ? AND user_id = ? AND catalog_id = ? AND version = ?`,
        [nextPity, caller.appId, caller.userId, catalogId, state.version],
      )
      assertAffected(stateUpdate)
      await tx.query(
        `INSERT INTO mip_blind_box_inventory (
           app_id, user_id, catalog_id, card_id, quantity
         ) VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE quantity = quantity + 1,
           last_acquired_at = UTC_TIMESTAMP(3)`,
        [caller.appId, caller.userId, catalogId, selected.id],
      )
      const inventory = await tx.one(
        `SELECT quantity FROM mip_blind_box_inventory
         WHERE app_id = ? AND user_id = ? AND card_id = ?`,
        [caller.appId, caller.userId, selected.id],
      )
      await tx.query(
        `INSERT INTO mip_blind_box_draws (
           id, app_id, user_id, catalog_id, card_id, request_id, coin_entry_id,
           cost_coin, balance_after, card_name_snapshot, card_summary_snapshot,
           rarity_snapshot, weight_snapshot, total_weight_snapshot, random_roll,
           catalog_version_snapshot, pity_threshold_snapshot, pity_min_rarity_snapshot,
           pity_before, pity_after, pity_triggered, inventory_quantity_after
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [drawId, caller.appId, caller.userId, catalogId, selected.id, requestId,
          coinEntryId, costCoin, balanceAfter, selected.name, selected.summary || '',
          selected.rarity, Number(selected.weight), selection.totalWeight, selection.roll,
          Number(catalog.version), Number(catalog.pity_threshold), catalog.pity_min_rarity,
          pityBefore, nextPity, pityTriggered ? 1 : 0, Number(inventory.quantity)],
      )
      await tx.query(
        `INSERT INTO mip_outbox_events (
           id, app_id, aggregate_type, aggregate_id, event_type,
           source_version, payload_json, status
         ) VALUES (?, ?, 'GROWTH_ENTRY', ?, 'game.coin_changed', ?, JSON_OBJECT(), 'PENDING')`,
        [outboxEventId, caller.appId, coinEntryId, Number(account.version) + 1],
      )
      return drawDto(await findDraw(tx, caller.appId, caller.userId, requestId), false)
    })
  }

  async function adminListBlindBoxCatalogs(caller) {
    await requireAdmin(database, caller, false)
    const rows = await database.query(
      `SELECT catalog.*,
              COUNT(card.id) AS card_count,
              COALESCE(SUM(card.stock_total), 0) AS stock_total,
              COALESCE(SUM(card.stock_remaining), 0) AS stock_remaining
       FROM mip_blind_box_catalogs catalog
       LEFT JOIN mip_blind_box_cards card
         ON card.app_id = catalog.app_id AND card.catalog_id = catalog.id
       WHERE catalog.app_id = ?
       GROUP BY catalog.app_id, catalog.id ORDER BY catalog.updated_at DESC, catalog.id`,
      [caller.appId],
    )
    return { items: rows.map(adminCatalogDto) }
  }

  async function adminSaveBlindBoxCatalog(caller, event = {}) {
    const draft = normalizeCatalogDraft(event.catalog)
    const catalogId = event.catalogId ? requiredId(event.catalogId) : createId()
    const version = event.catalogId ? expectedVersion(event.expectedVersion) : null
    return runAdminMutation(
      caller,
      event,
      'mip.admin.game.blindBoxes.catalogs.save',
      { catalogId: event.catalogId || null, expectedVersion: version, catalog: draft },
      async (tx, roleKey) => {
        if (!event.catalogId) {
          await tx.query(
            `INSERT INTO mip_blind_box_catalogs (
             id, app_id, catalog_key, name, summary, rules_text, redemption_rules_text,
             draw_cost_coin, daily_draw_limit, pity_threshold, pity_min_rarity,
             created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [catalogId, caller.appId, draft.catalogKey, draft.name, draft.summary,
              draft.rulesText, draft.redemptionRulesText, draft.drawCostCoin,
              draft.dailyDrawLimit, draft.pityThreshold, draft.pityMinRarity,
              caller.userId, caller.userId],
          )
          await writeAudit(tx, caller, roleKey, 'game.blind_box.catalog_created', 'BLIND_BOX_CATALOG', catalogId)
        }
        else {
          const current = await tx.one(
            `SELECT status, version FROM mip_blind_box_catalogs
           WHERE app_id = ? AND id = ? FOR UPDATE`,
            [caller.appId, catalogId],
          )
          if (!current) throw new Error('NOT_FOUND')
          if (Number(current.version) !== version) throw new Error('CONFLICT')
          const update = await tx.query(
            `UPDATE mip_blind_box_catalogs
           SET catalog_key = ?, name = ?, summary = ?, rules_text = ?,
               redemption_rules_text = ?, draw_cost_coin = ?, daily_draw_limit = ?,
               pity_threshold = ?, pity_min_rarity = ?, updated_by_user_id = ?,
               version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
            [draft.catalogKey, draft.name, draft.summary, draft.rulesText,
              draft.redemptionRulesText, draft.drawCostCoin, draft.dailyDrawLimit,
              draft.pityThreshold, draft.pityMinRarity, caller.userId,
              caller.appId, catalogId, version],
          )
          assertAffected(update)
          await assertPublishedCatalogInvariant(tx, caller.appId, {
            id: catalogId,
            status: current.status,
            pity_min_rarity: draft.pityMinRarity,
          })
          await writeAudit(tx, caller, roleKey, 'game.blind_box.catalog_updated', 'BLIND_BOX_CATALOG', catalogId)
        }
        return adminCatalogDto(await tx.one(
          `SELECT catalog.*, COUNT(card.id) AS card_count,
                COALESCE(SUM(card.stock_total), 0) AS stock_total,
                COALESCE(SUM(card.stock_remaining), 0) AS stock_remaining
         FROM mip_blind_box_catalogs catalog
         LEFT JOIN mip_blind_box_cards card
           ON card.app_id = catalog.app_id AND card.catalog_id = catalog.id
         WHERE catalog.app_id = ? AND catalog.id = ?
         GROUP BY catalog.app_id, catalog.id`,
          [caller.appId, catalogId],
        ))
      },
    )
  }

  async function adminChangeBlindBoxCatalogStatus(caller, event = {}) {
    const catalogId = requiredId(event.catalogId)
    const version = expectedVersion(event.expectedVersion)
    const status = enumValue(event.status, ['PUBLISHED', 'UNPUBLISHED'])
    return runAdminMutation(
      caller,
      event,
      'mip.admin.game.blindBoxes.catalogs.changeStatus',
      { catalogId, expectedVersion: version, status },
      async (tx, roleKey) => {
        const catalog = await tx.one(
          `SELECT status, version, pity_min_rarity FROM mip_blind_box_catalogs
         WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, catalogId],
        )
        if (!catalog) throw new Error('NOT_FOUND')
        if (Number(catalog.version) !== version) throw new Error('CONFLICT')
        if ((catalog.status === 'PUBLISHED' && status === 'PUBLISHED')
        || (catalog.status !== 'PUBLISHED' && status === 'UNPUBLISHED')) {
          throw new Error('INVALID_STATE')
        }
        const update = await tx.query(
          `UPDATE mip_blind_box_catalogs
         SET status = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
          [status, caller.userId, caller.appId, catalogId, version],
        )
        assertAffected(update)
        await assertPublishedCatalogInvariant(tx, caller.appId, { ...catalog, id: catalogId, status })
        await writeAudit(tx, caller, roleKey, `game.blind_box.catalog_${status.toLowerCase()}`, 'BLIND_BOX_CATALOG', catalogId)
        return { catalogId, status, version: version + 1 }
      },
    )
  }

  async function adminListBlindBoxCards(caller, event = {}) {
    await requireAdmin(database, caller, false)
    const catalogId = requiredId(event.catalogId)
    const rows = await database.query(
      `SELECT * FROM mip_blind_box_cards
       WHERE app_id = ? AND catalog_id = ?
       ORDER BY display_order, name, id`,
      [caller.appId, catalogId],
    )
    return { items: rows.map(adminCardDto) }
  }

  async function adminSaveBlindBoxCard(caller, event = {}) {
    const draft = normalizeCardDraft(event.card)
    const cardId = event.cardId ? requiredId(event.cardId) : createId()
    const version = event.cardId ? expectedVersion(event.expectedVersion) : null
    return runAdminMutation(
      caller,
      event,
      'mip.admin.game.blindBoxes.cards.save',
      { cardId: event.cardId || null, expectedVersion: version, card: draft },
      async (tx, roleKey) => {
        const catalog = await tx.one(
          `SELECT id, status, pity_min_rarity FROM mip_blind_box_catalogs
         WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, draft.catalogId],
        )
        if (!catalog) throw new Error('NOT_FOUND')
        if (!event.cardId) {
          await tx.query(
            `INSERT INTO mip_blind_box_cards (
             id, app_id, catalog_id, card_key, name, summary, rarity, weight,
             stock_total, stock_remaining, display_order, created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cardId, caller.appId, draft.catalogId, draft.cardKey, draft.name,
              draft.summary, draft.rarity, draft.weight, draft.stockTotal,
              draft.stockTotal, draft.displayOrder, caller.userId, caller.userId],
          )
          await writeAudit(tx, caller, roleKey, 'game.blind_box.card_created', 'BLIND_BOX_CARD', cardId)
        }
        else {
          const current = await tx.one(
            `SELECT catalog_id, stock_total, stock_remaining, version
           FROM mip_blind_box_cards WHERE app_id = ? AND id = ? FOR UPDATE`,
            [caller.appId, cardId],
          )
          if (!current) throw new Error('NOT_FOUND')
          if (current.catalog_id !== draft.catalogId || Number(current.version) !== version) {
            throw new Error('CONFLICT')
          }
          const acquired = Number(current.stock_total) - Number(current.stock_remaining)
          if (draft.stockTotal < acquired) throw new Error('BLIND_BOX_STOCK_CONFLICT')
          const stockRemaining = draft.stockTotal - acquired
          const update = await tx.query(
            `UPDATE mip_blind_box_cards
           SET card_key = ?, name = ?, summary = ?, rarity = ?, weight = ?,
               stock_total = ?, stock_remaining = ?, display_order = ?,
               updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
            [draft.cardKey, draft.name, draft.summary, draft.rarity, draft.weight,
              draft.stockTotal, stockRemaining, draft.displayOrder, caller.userId,
              caller.appId, cardId, version],
          )
          assertAffected(update)
          await writeAudit(tx, caller, roleKey, 'game.blind_box.card_updated', 'BLIND_BOX_CARD', cardId)
        }
        await assertPublishedCatalogInvariant(tx, caller.appId, catalog)
        return adminCardDto(await tx.one(
          `SELECT * FROM mip_blind_box_cards WHERE app_id = ? AND id = ?`,
          [caller.appId, cardId],
        ))
      },
    )
  }

  async function adminChangeBlindBoxCardStatus(caller, event = {}) {
    const cardId = requiredId(event.cardId)
    const version = expectedVersion(event.expectedVersion)
    const status = enumValue(event.status, ['PUBLISHED', 'UNPUBLISHED'])
    return runAdminMutation(
      caller,
      event,
      'mip.admin.game.blindBoxes.cards.changeStatus',
      { cardId, expectedVersion: version, status },
      async (tx, roleKey) => {
        const cardReference = await tx.one(
          `SELECT catalog_id FROM mip_blind_box_cards WHERE app_id = ? AND id = ?`,
          [caller.appId, cardId],
        )
        if (!cardReference) throw new Error('NOT_FOUND')
        const catalog = await tx.one(
          `SELECT id, status, pity_min_rarity FROM mip_blind_box_catalogs
         WHERE app_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, cardReference.catalog_id],
        )
        if (!catalog) throw new Error('NOT_FOUND')
        const card = await tx.one(
          `SELECT status, stock_remaining, version FROM mip_blind_box_cards
         WHERE app_id = ? AND catalog_id = ? AND id = ? FOR UPDATE`,
          [caller.appId, catalog.id, cardId],
        )
        if (!card) throw new Error('NOT_FOUND')
        if (Number(card.version) !== version) throw new Error('CONFLICT')
        if (status === 'PUBLISHED' && Number(card.stock_remaining) < 1) {
          throw new Error('BLIND_BOX_STOCK_UNAVAILABLE')
        }
        if ((card.status === 'PUBLISHED' && status === 'PUBLISHED')
        || (card.status !== 'PUBLISHED' && status === 'UNPUBLISHED')) {
          throw new Error('INVALID_STATE')
        }
        const update = await tx.query(
          `UPDATE mip_blind_box_cards
         SET status = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
          [status, caller.userId, caller.appId, cardId, version],
        )
        assertAffected(update)
        await assertPublishedCatalogInvariant(tx, caller.appId, catalog)
        await writeAudit(tx, caller, roleKey, `game.blind_box.card_${status.toLowerCase()}`, 'BLIND_BOX_CARD', cardId)
        return { cardId, status, version: version + 1 }
      },
    )
  }

  async function requireAdmin(db, caller, lock) {
    if (typeof assertAdmin !== 'function') throw new Error('FORBIDDEN')
    return assertAdmin(db, caller, lock)
  }

  return {
    adminChangeBlindBoxCardStatus,
    adminChangeBlindBoxCatalogStatus,
    adminListBlindBoxCards,
    adminListBlindBoxCatalogs,
    adminSaveBlindBoxCard,
    adminSaveBlindBoxCatalog,
    drawBlindBox,
    getBlindBox,
    getBlindBoxInventory,
    listBlindBoxCoinEntries,
    listBlindBoxes,
  }
}

async function findDraw(database, appId, userId, requestId) {
  return database.one(
    `SELECT * FROM mip_blind_box_draws
     WHERE app_id = ? AND user_id = ? AND request_id = ?`,
    [appId, userId, requestId],
  )
}

function selectWeightedCard(cards, secureRandomInt) {
  const totalWeight = cards.reduce((total, card) => total + Number(card.weight), 0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight < 1) throw new Error('INVALID_STATE')
  const roll = secureRandomInt(totalWeight)
  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= totalWeight) throw new Error('INVALID_STATE')
  let cursor = roll
  for (const card of cards) {
    cursor -= Number(card.weight)
    if (cursor < 0) return { card, roll, totalWeight }
  }
  throw new Error('INVALID_STATE')
}

function normalizeCatalogDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const catalogKey = boundedText(value.catalogKey, 64, true)
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(catalogKey)) throw new Error('VALIDATION_FAILED')
  return {
    catalogKey,
    name: boundedText(value.name, 100, true),
    summary: boundedText(value.summary, 500),
    rulesText: boundedText(value.rulesText, 4000, true),
    redemptionRulesText: boundedText(value.redemptionRulesText, 4000, true),
    drawCostCoin: boundedInteger(value.drawCostCoin, 1, 100000),
    dailyDrawLimit: boundedInteger(value.dailyDrawLimit ?? 20, 1, 100),
    pityThreshold: boundedInteger(value.pityThreshold ?? 10, 1, 100),
    pityMinRarity: enumValue(value.pityMinRarity ?? 'RARE', RARITIES),
  }
}

function normalizeCardDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const rarity = enumValue(value.rarity, RARITIES)
  const cardKey = boundedText(value.cardKey, 64, true)
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(cardKey)) throw new Error('VALIDATION_FAILED')
  return {
    catalogId: requiredId(value.catalogId),
    cardKey,
    name: boundedText(value.name, 100, true),
    summary: boundedText(value.summary, 500),
    rarity,
    weight: boundedInteger(value.weight ?? DEFAULT_WEIGHTS[rarity], 1, 1000000),
    stockTotal: boundedInteger(value.stockTotal, 0, 100000000),
    displayOrder: boundedInteger(value.displayOrder ?? 0, 0, 1000000),
  }
}

function rarityBreakdown(cards) {
  const available = cards.filter(card => Number(card.stock_remaining) > 0)
  const totalWeight = available.reduce((total, card) => total + Number(card.weight), 0)
  return RARITIES.map((rarity) => {
    const matching = available.filter(card => card.rarity === rarity)
    const weight = matching.reduce((total, card) => total + Number(card.weight), 0)
    return {
      rarity,
      label: RARITY_LABELS[rarity],
      weight,
      probabilityBasisPoints: totalWeight ? Math.floor(weight * 10000 / totalWeight) : 0,
      availableCardCount: matching.length,
    }
  })
}

function catalogSummaryDto(row) {
  return {
    id: row.id,
    catalogKey: row.catalog_key,
    name: row.name,
    summary: row.summary || '',
    drawCostCoin: Number(row.draw_cost_coin),
    dailyDrawLimit: Number(row.daily_draw_limit),
    pityThreshold: Number(row.pity_threshold),
    pityMinRarity: row.pity_min_rarity,
    status: row.status,
    version: Number(row.version),
    cardCount: Number(row.card_count || 0),
    stockRemaining: Number(row.stock_remaining || 0),
  }
}

function adminCatalogDto(row) {
  return {
    ...catalogSummaryDto(row),
    rulesText: row.rules_text,
    redemptionRulesText: row.redemption_rules_text,
    stockTotal: Number(row.stock_total || 0),
  }
}

function publicCardDto(row) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary || '',
    rarity: row.rarity,
    status: row.status || 'PUBLISHED',
    stockRemaining: Number(row.stock_remaining || 0),
  }
}

function adminCardDto(row) {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    cardKey: row.card_key,
    name: row.name,
    summary: row.summary || '',
    rarity: row.rarity,
    weight: Number(row.weight),
    stockTotal: Number(row.stock_total),
    stockRemaining: Number(row.stock_remaining),
    displayOrder: Number(row.display_order),
    status: row.status,
    version: Number(row.version),
  }
}

function inventoryDto(row) {
  return {
    cardId: row.card_id,
    catalogId: row.catalog_id,
    catalogName: row.catalog_name,
    name: row.name,
    summary: row.summary || '',
    rarity: row.rarity,
    status: row.status,
    quantity: Number(row.quantity || 0),
    firstAcquiredAt: iso(row.first_acquired_at),
    lastAcquiredAt: iso(row.last_acquired_at),
  }
}

function drawDto(row, idempotent) {
  return {
    drawId: row.id,
    catalogId: row.catalog_id,
    card: {
      id: row.card_id,
      name: row.card_name_snapshot,
      summary: row.card_summary_snapshot || '',
      rarity: row.rarity_snapshot,
    },
    costCoin: Number(row.cost_coin),
    balanceAfter: Number(row.balance_after),
    inventoryQuantity: Number(row.inventory_quantity_after),
    pityBefore: Number(row.pity_before),
    pityAfter: Number(row.pity_after),
    pityTriggered: Boolean(row.pity_triggered),
    drawnAt: iso(row.created_at),
    idempotent,
  }
}

function rarityRank(value) {
  const index = RARITIES.indexOf(value)
  if (index < 0) throw new Error('INVALID_STATE')
  return index
}

async function assertPublishedCatalogInvariant(database, appId, catalog) {
  if (catalog.status !== 'PUBLISHED') return
  const cards = await database.query(
    `SELECT id, rarity FROM mip_blind_box_cards
     WHERE app_id = ? AND catalog_id = ? AND status = 'PUBLISHED'
       AND stock_remaining > 0
     ORDER BY id FOR UPDATE`,
    [appId, catalog.id],
  )
  if (!cards.some(card => rarityRank(card.rarity) >= rarityRank(catalog.pity_min_rarity))) {
    throw new Error('BLIND_BOX_PITY_STOCK_UNAVAILABLE')
  }
}

function boundedInteger(value, minimum, maximum) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function enumValue(value, values) {
  const result = boundedText(value, 32, true).toUpperCase()
  if (!values.includes(result)) throw new Error('VALIDATION_FAILED')
  return result
}

function normalizeLimit(value, fallback) {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > 100) throw new Error('VALIDATION_FAILED')
  return result
}

function assertAffected(result) {
  if (Number(result?.affectedRows) !== 1) throw new Error('CONFLICT')
}

async function writeAudit(database, caller, roleKey, action, resourceType, resourceId) {
  await database.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', 'PLATFORM', ?, ?, ?, ?, ?, JSON_OBJECT())`,
    [caller.appId, caller.userId, PLATFORM_SCOPE_ID, action, resourceType, resourceId, roleKey],
  )
}

function iso(value) { return value ? new Date(value).toISOString() : '' }

module.exports = {
  DEFAULT_WEIGHTS,
  RARITIES,
  createBlindBoxRepository,
  assertPublishedCatalogInvariant,
  normalizeCardDraft,
  normalizeCatalogDraft,
  rarityBreakdown,
  selectWeightedCard,
}
