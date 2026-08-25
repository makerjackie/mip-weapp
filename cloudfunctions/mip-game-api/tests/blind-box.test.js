'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  DEFAULT_WEIGHTS,
  assertPublishedCatalogInvariant,
  createBlindBoxRepository,
  normalizeCardDraft,
  normalizeCatalogDraft,
  rarityBreakdown,
  selectWeightedCard,
} = require('../domain/blind-box')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const catalogId = '20000000-0000-4000-8000-000000000001'
const requestId = '30000000-0000-4000-8000-000000000001'
const cardId = '40000000-0000-4000-8000-000000000001'
const drawId = '50000000-0000-4000-8000-000000000001'
const coinEntryId = '60000000-0000-4000-8000-000000000001'
const outboxEventId = '70000000-0000-4000-8000-000000000001'
const caller = { appId, userId }

describe('blind box rules', () => {
  it('normalizes replaceable catalog and rarity defaults', () => {
    assert.deepEqual(normalizeCatalogDraft({
      catalogKey: 'benben-default',
      name: '笨笨盲盒',
      summary: '',
      rulesText: '每次抽取消耗游戏币。',
      redemptionRulesText: '兑换规则以后台发布内容为准。',
      drawCostCoin: 5,
    }), {
      catalogKey: 'benben-default',
      name: '笨笨盲盒',
      summary: '',
      rulesText: '每次抽取消耗游戏币。',
      redemptionRulesText: '兑换规则以后台发布内容为准。',
      drawCostCoin: 5,
      dailyDrawLimit: 20,
      pityThreshold: 10,
      pityMinRarity: 'RARE',
    })
    const card = normalizeCardDraft({
      catalogId,
      cardKey: 'member-card',
      name: '会员卡牌',
      summary: '',
      rarity: 'EPIC',
      stockTotal: 100,
    })
    assert.equal(card.weight, DEFAULT_WEIGHTS.EPIC)
  })

  it('selects only by server weights and exposes an aggregate rarity breakdown', () => {
    const cards = [
      { id: 'common', rarity: 'COMMON', weight: 70, stock_remaining: 10 },
      { id: 'rare', rarity: 'RARE', weight: 30, stock_remaining: 1 },
    ]
    assert.deepEqual(selectWeightedCard(cards, () => 70), {
      card: cards[1],
      roll: 70,
      totalWeight: 100,
    })
    assert.deepEqual(rarityBreakdown(cards).slice(0, 2), [
      { rarity: 'COMMON', label: '普通', weight: 70, probabilityBasisPoints: 7000, availableCardCount: 1 },
      { rarity: 'RARE', label: '稀有', weight: 30, probabilityBasisPoints: 3000, availableCardCount: 1 },
    ])
  })
})

describe('blind box draw transaction', () => {
  it('locks stock and balance, appends the coin ledger, and grants one card', async () => {
    const writes = []
    const ids = [drawId, coinEntryId, outboxEventId]
    const repository = createBlindBoxRepository(transactionDatabase({ writes }), {
      createId: () => ids.shift(),
      randomInt: () => 70,
    })
    const result = await repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId })

    assert.equal(result.card.id, cardId)
    assert.equal(result.costCoin, 5)
    assert.equal(result.balanceAfter, 7)
    assert.equal(result.inventoryQuantity, 2)
    assert.equal(result.idempotent, false)
    assert.match(writes.find(item => item.sql.includes('UPDATE mip_growth_accounts')).sql, /version = version \+ 1/)
    const ledger = writes.find(item => item.sql.includes('INSERT INTO mip_growth_entries'))
    assert.equal(ledger.params[4], -5)
    assert.equal(ledger.params[5], 7)
    assert.match(writes.find(item => item.sql.includes('UPDATE mip_blind_box_cards')).sql, /stock_remaining = stock_remaining - 1/)
    assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_blind_box_inventory')))
    assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_blind_box_draws')))
    assert.ok(writes.some(item => item.sql.includes("'game.coin_changed'")))
  })

  it('replays the immutable draw result without charging or decrementing stock twice', async () => {
    const reads = []
    let writes = 0
    const database = {
      async transaction(work) {
        return work({
          async one(sql) {
            reads.push(sql)
            if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
            if (sql.includes('FROM mip_membership_entitlements')) return { id: 'entitlement' }
            return {
              id: drawId,
              catalog_id: catalogId,
              card_id: cardId,
              card_name_snapshot: '稀有卡牌',
              card_summary_snapshot: '',
              rarity_snapshot: 'RARE',
              cost_coin: 5,
              balance_after: 7,
              inventory_quantity_after: 2,
              pity_before: 1,
              pity_after: 0,
              pity_triggered: 0,
              created_at: new Date('2026-08-24T00:00:00.000Z'),
            }
          },
          async query() { writes += 1 },
        })
      },
    }
    const repository = createBlindBoxRepository(database)
    const result = await repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId })
    assert.equal(result.idempotent, true)
    assert.equal(result.balanceAfter, 7)
    assert.equal(result.card.name, '稀有卡牌')
    assert.equal(result.inventoryQuantity, 2)
    assert.equal(writes, 0)
    const userRead = reads.findIndex(sql => sql.includes('FROM mip_users'))
    const drawRead = reads.findIndex(sql => sql.includes('FROM mip_blind_box_draws'))
    assert.ok(userRead >= 0 && userRead < drawRead)
    assert.match(reads[userRead], /FOR UPDATE/)
    assert.doesNotMatch(reads[drawRead], /FOR UPDATE/)
  })

  it('rejects reusing one request id for a different catalog', async () => {
    const otherCatalogId = '20000000-0000-4000-8000-000000000002'
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
            if (sql.includes('FROM mip_membership_entitlements')) return { id: 'entitlement' }
            return { catalog_id: otherCatalogId }
          },
          async query() { throw new Error('unexpected write') },
        })
      },
    })
    await assert.rejects(
      repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId }),
      /IDEMPOTENCY_CONFLICT/,
    )
  })

  it('locks and rechecks an effective membership before reading or writing a draw', async () => {
    const calls = []
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            calls.push(sql)
            if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
            if (sql.includes('FROM mip_membership_entitlements')) return null
            throw new Error('draw should not be read')
          },
          async query() { throw new Error('draw should not be written') },
        })
      },
    })
    await assert.rejects(
      repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId }),
      /MEMBERSHIP_REQUIRED/,
    )
    assert.match(calls[1], /LIMIT 1 FOR UPDATE/)
    assert.equal(calls.some(sql => sql.includes('mip_blind_box_draws')), false)
  })

  it('refuses a negative balance and rejects client-supplied draw facts', async () => {
    const repository = createBlindBoxRepository(transactionDatabase({ coinBalance: 4 }), {
      randomInt: () => 0,
    })
    await assert.rejects(
      repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId }),
      /INSUFFICIENT_GAME_COIN_BALANCE/,
    )
    await assert.rejects(
      repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId, costCoin: 0 }),
      /VALIDATION_FAILED/,
    )
  })

  it('uses only eligible rarity stock when the server pity threshold is reached', async () => {
    const database = transactionDatabase({ pityCount: 9, inventoryQuantity: 1 })
    const repository = createBlindBoxRepository(database, {
      createId: (() => {
        const ids = [drawId, coinEntryId, outboxEventId]
        return () => ids.shift()
      })(),
      randomInt: () => 0,
    })
    const result = await repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId })
    assert.equal(result.card.rarity, 'RARE')
    assert.equal(result.pityTriggered, true)
    assert.equal(result.pityBefore, 9)
    assert.equal(result.pityAfter, 0)
    const drawWrite = database.writes.find(item => item.sql.includes('INSERT INTO mip_blind_box_draws'))
    assert.equal(drawWrite.params[14], 0)
    assert.equal(drawWrite.params[15], 3)
    assert.equal(drawWrite.params[16], 10)
    assert.equal(drawWrite.params[17], 'RARE')
  })

  it('rolls back a draw that would leave a published catalog without pity stock', async () => {
    const repository = createBlindBoxRepository(transactionDatabase({ invariantCards: [] }), {
      randomInt: () => 0,
    })
    await assert.rejects(
      repository.drawBlindBox(caller, { action: 'drawBlindBox', catalogId, requestId }),
      /BLIND_BOX_PITY_STOCK_UNAVAILABLE/,
    )
  })
})

describe('blind box administration', () => {
  it('creates configurable catalogs and appends an admin audit record', async () => {
    const writes = []
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('COUNT(card.id) AS card_count')) {
              return {
                id: catalogId,
                catalog_key: 'benben-default',
                name: '笨笨盲盒',
                summary: '',
                rules_text: '服务端按库存和权重抽取。',
                redemption_rules_text: '兑换规则以后台配置为准。',
                draw_cost_coin: 5,
                daily_draw_limit: 20,
                pity_threshold: 10,
                pity_min_rarity: 'RARE',
                status: 'DRAFT',
                version: 1,
                card_count: 0,
                stock_total: 0,
                stock_remaining: 0,
              }
            }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }, {
      createId: () => catalogId,
      assertAdmin: async () => 'PLATFORM_OWNER',
    })

    const result = await repository.adminSaveBlindBoxCatalog(caller, {
      catalog: {
        catalogKey: 'benben-default',
        name: '笨笨盲盒',
        summary: '',
        rulesText: '服务端按库存和权重抽取。',
        redemptionRulesText: '兑换规则以后台配置为准。',
        drawCostCoin: 5,
        dailyDrawLimit: 20,
        pityThreshold: 10,
        pityMinRarity: 'RARE',
      },
    })

    assert.equal(result.id, catalogId)
    assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_blind_box_catalogs')))
    assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_audit_logs')
      && item.params.includes('game.blind_box.catalog_created')))
  })

  it('does not allow stock total to drop below already acquired quantity', async () => {
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_blind_box_catalogs')) return { id: catalogId }
            if (sql.includes('FROM mip_blind_box_cards')) {
              return { catalog_id: catalogId, stock_total: 10, stock_remaining: 4, version: 1 }
            }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query() { return { affectedRows: 1 } },
        })
      },
    }, { assertAdmin: async () => 'PLATFORM_OWNER' })

    await assert.rejects(repository.adminSaveBlindBoxCard(caller, {
      cardId,
      expectedVersion: 1,
      card: {
        catalogId,
        cardKey: 'rare-card',
        name: '稀有卡牌',
        summary: '',
        rarity: 'RARE',
        weight: 2200,
        stockTotal: 5,
        displayOrder: 0,
      },
    }), /BLIND_BOX_STOCK_CONFLICT/)
  })

  it('requires every published catalog to retain stocked pity-eligible cards', async () => {
    const reads = []
    await assert.rejects(assertPublishedCatalogInvariant({
      async query(sql) {
        reads.push(sql)
        return [{ id: cardId, rarity: 'COMMON' }]
      },
    }, appId, {
      id: catalogId,
      status: 'PUBLISHED',
      pity_min_rarity: 'RARE',
    }), /BLIND_BOX_PITY_STOCK_UNAVAILABLE/)
    assert.match(reads[0], /status = 'PUBLISHED'/)
    assert.match(reads[0], /stock_remaining > 0/)
    assert.match(reads[0], /FOR UPDATE/)
  })

  it('rechecks the pity invariant when publishing a catalog', async () => {
    const calls = []
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            calls.push(sql)
            return { status: 'DRAFT', version: 1, pity_min_rarity: 'EPIC' }
          },
          async query(sql) {
            calls.push(sql)
            if (sql.includes('SELECT id, rarity')) return [{ id: cardId, rarity: 'RARE' }]
            return { affectedRows: 1 }
          },
        })
      },
    }, { assertAdmin: async () => 'PLATFORM_OWNER' })
    await assert.rejects(repository.adminChangeBlindBoxCatalogStatus(caller, {
      catalogId,
      expectedVersion: 1,
      status: 'PUBLISHED',
    }), /BLIND_BOX_PITY_STOCK_UNAVAILABLE/)
    assert.ok(calls.some(sql => sql.includes('UPDATE mip_blind_box_catalogs')))
  })

  it('rejects a published rule update when the new minimum rarity has no stock', async () => {
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('SELECT status, version')) return { status: 'PUBLISHED', version: 1 }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query(sql) {
            if (sql.includes('SELECT id, rarity')) return [{ id: cardId, rarity: 'RARE' }]
            return { affectedRows: 1 }
          },
        })
      },
    }, { assertAdmin: async () => 'PLATFORM_OWNER' })
    await assert.rejects(repository.adminSaveBlindBoxCatalog(caller, {
      catalogId,
      expectedVersion: 1,
      catalog: {
        catalogKey: 'benben-default',
        name: '笨笨盲盒',
        summary: '',
        rulesText: '服务端按库存和权重抽取。',
        redemptionRulesText: '兑换规则以后台配置为准。',
        drawCostCoin: 5,
        dailyDrawLimit: 20,
        pityThreshold: 10,
        pityMinRarity: 'EPIC',
      },
    }), /BLIND_BOX_PITY_STOCK_UNAVAILABLE/)
  })

  it('locks the catalog before a card status change and rejects an invalid published state', async () => {
    const calls = []
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            calls.push(sql)
            if (sql.includes('SELECT catalog_id')) return { catalog_id: catalogId }
            if (sql.includes('FROM mip_blind_box_catalogs')) {
              return { id: catalogId, status: 'PUBLISHED', pity_min_rarity: 'RARE' }
            }
            if (sql.includes('FROM mip_blind_box_cards')) {
              return { status: 'PUBLISHED', stock_remaining: 1, version: 1 }
            }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query(sql) {
            calls.push(sql)
            if (sql.includes('SELECT id, rarity')) return []
            return { affectedRows: 1 }
          },
        })
      },
    }, { assertAdmin: async () => 'PLATFORM_OWNER' })
    await assert.rejects(repository.adminChangeBlindBoxCardStatus(caller, {
      cardId,
      expectedVersion: 1,
      status: 'UNPUBLISHED',
    }), /BLIND_BOX_PITY_STOCK_UNAVAILABLE/)
    const catalogLock = calls.findIndex(sql => sql.includes('FROM mip_blind_box_catalogs'))
    const cardLock = calls.findIndex(sql => sql.includes('FROM mip_blind_box_cards') && sql.includes('FOR UPDATE'))
    assert.ok(catalogLock >= 0 && cardLock > catalogLock)
  })

  it('rechecks the published invariant after card rarity or stock edits', async () => {
    const repository = createBlindBoxRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_blind_box_catalogs')) {
              return { id: catalogId, status: 'PUBLISHED', pity_min_rarity: 'RARE' }
            }
            if (sql.includes('FROM mip_blind_box_cards')) {
              return { catalog_id: catalogId, stock_total: 1, stock_remaining: 1, version: 1 }
            }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query(sql) {
            if (sql.includes('SELECT id, rarity')) return []
            return { affectedRows: 1 }
          },
        })
      },
    }, { assertAdmin: async () => 'PLATFORM_OWNER' })
    await assert.rejects(repository.adminSaveBlindBoxCard(caller, {
      cardId,
      expectedVersion: 1,
      card: {
        catalogId,
        cardKey: 'rare-card',
        name: '稀有卡牌',
        summary: '',
        rarity: 'COMMON',
        weight: 7000,
        stockTotal: 0,
        displayOrder: 0,
      },
    }), /BLIND_BOX_PITY_STOCK_UNAVAILABLE/)
  })
})

function transactionDatabase(options = {}) {
  const writes = options.writes || []
  const database = {
    writes,
    async transaction(work) {
      let storedDraw = null
      return work({
        async one(sql) {
          if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
          if (sql.includes('FROM mip_membership_entitlements')) return { id: 'entitlement' }
          if (sql.includes('FROM mip_blind_box_draws')) return storedDraw
          if (sql.includes('FROM mip_blind_box_catalogs')) {
            return {
              id: catalogId,
              name: '笨笨盲盒',
              status: 'PUBLISHED',
              draw_cost_coin: 5,
              daily_draw_limit: 20,
              pity_threshold: 10,
              pity_min_rarity: 'RARE',
              version: 3,
            }
          }
          if (sql.includes('COUNT(*) AS draw_count')) return { draw_count: 0 }
          if (sql.includes('FROM mip_blind_box_user_states')) {
            return { draw_count: 0, pity_count: options.pityCount || 0, version: 1 }
          }
          if (sql.includes('FROM mip_growth_accounts')) {
            return { coin_balance: options.coinBalance ?? 12, version: 1 }
          }
          if (sql.includes('FROM mip_blind_box_inventory')) {
            return { quantity: options.inventoryQuantity ?? 2 }
          }
          throw new Error(`unexpected one: ${sql}`)
        },
        async query(sql, params) {
          if (sql.includes('SELECT id, name, summary, rarity, weight, stock_remaining')) {
            return [
              { id: '40000000-0000-4000-8000-000000000002', name: '普通卡牌', summary: '', rarity: 'COMMON', weight: 70, stock_remaining: 10 },
              { id: cardId, name: '稀有卡牌', summary: '', rarity: 'RARE', weight: 30, stock_remaining: 5 },
            ]
          }
          if (sql.includes('SELECT id, rarity FROM mip_blind_box_cards')) {
            return options.invariantCards ?? [{ id: cardId, rarity: 'RARE' }]
          }
          writes.push({ sql, params })
          if (sql.includes('INSERT INTO mip_blind_box_draws')) {
            storedDraw = {
              id: params[0],
              catalog_id: params[3],
              card_id: params[4],
              cost_coin: params[7],
              balance_after: params[8],
              card_name_snapshot: params[9],
              card_summary_snapshot: params[10],
              rarity_snapshot: params[11],
              pity_before: params[18],
              pity_after: params[19],
              pity_triggered: params[20],
              inventory_quantity_after: params[21],
              created_at: new Date('2026-08-25T00:00:00.000Z'),
            }
          }
          return { affectedRows: 1 }
        },
      })
    },
  }
  return database
}
