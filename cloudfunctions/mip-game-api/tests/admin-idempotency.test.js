'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { gameAdminMutation, requestHash } = require('../domain/admin-idempotency')
const { createBlindBoxRepository } = require('../domain/blind-box')
const { createGameRepository } = require('../domain/repository')

const APP_ID = 'wx-app'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const SEASON_ID = '20000000-0000-4000-8000-000000000001'
const CATALOG_ID = '30000000-0000-4000-8000-000000000001'
const caller = { appId: APP_ID, userId: USER_ID }

describe('Game admin durable idempotency', () => {
  it('replays a completed season mutation before the changed version and rejects request drift', async () => {
    const database = transactionalGameDatabase()
    const repository = createGameRepository(database, {
      createIdempotencyId: () => '40000000-0000-4000-8000-000000000001',
    })
    const request = {
      seasonId: SEASON_ID,
      expectedVersion: 1,
      status: 'CLOSED',
      idempotencyKey: 'game-season-status-0001',
    }

    const first = await repository.changeSeasonStatus(caller, request)
    const replay = await repository.changeSeasonStatus(caller, request)

    assert.equal(first.status, 'CLOSED')
    assert.equal(first.version, 2)
    assert.equal(first.idempotent, false)
    assert.deepEqual(replay, { ...first, idempotent: true })
    assert.equal(database.snapshot().auditCount, 1)
    assert.equal(database.snapshot().idempotency.size, 1)
    await assert.rejects(
      repository.changeSeasonStatus(caller, { ...request, status: 'ACTIVE' }),
      error => error.code === 'IDEMPOTENCY_CONFLICT',
    )
  })

  it('replays a completed blind-box mutation and rejects request drift', async () => {
    const database = transactionalGameDatabase()
    const repository = createBlindBoxRepository(database, {
      createIdempotencyId: () => '40000000-0000-4000-8000-000000000002',
      assertAdmin: async () => 'PLATFORM_OWNER',
    })
    const request = {
      catalogId: CATALOG_ID,
      expectedVersion: 1,
      status: 'UNPUBLISHED',
      idempotencyKey: 'game-catalog-status-0001',
    }

    const first = await repository.adminChangeBlindBoxCatalogStatus(caller, request)
    const replay = await repository.adminChangeBlindBoxCatalogStatus(caller, request)

    assert.deepEqual(first, {
      catalogId: CATALOG_ID,
      status: 'UNPUBLISHED',
      version: 2,
      idempotent: false,
    })
    assert.deepEqual(replay, { ...first, idempotent: true })
    assert.equal(database.snapshot().auditCount, 1)
    assert.equal(database.snapshot().idempotency.size, 1)
    await assert.rejects(
      repository.adminChangeBlindBoxCatalogStatus(caller, { ...request, status: 'PUBLISHED' }),
      error => error.code === 'IDEMPOTENCY_CONFLICT',
    )
  })

  it('rolls back the season claim and business write together so the same key can recover', async () => {
    const database = transactionalGameDatabase({ failAuditCount: 1 })
    const repository = createGameRepository(database, {
      createIdempotencyId: () => '40000000-0000-4000-8000-000000000003',
    })
    const request = {
      seasonId: SEASON_ID,
      expectedVersion: 1,
      status: 'CLOSED',
      idempotencyKey: 'game-season-recovery-0001',
    }

    await assert.rejects(repository.changeSeasonStatus(caller, request), /INJECTED_FAILURE/)
    assert.equal(database.snapshot().season.status, 'ACTIVE')
    assert.equal(database.snapshot().season.version, 1)
    assert.equal(database.snapshot().idempotency.size, 0)

    const recovered = await repository.changeSeasonStatus(caller, request)
    assert.equal(recovered.idempotent, false)
    assert.equal(database.snapshot().season.status, 'CLOSED')
    assert.equal(database.snapshot().idempotency.size, 1)
  })

  it('rolls back the blind-box claim and status change together so the same key can recover', async () => {
    const database = transactionalGameDatabase({ failAuditCount: 1 })
    const repository = createBlindBoxRepository(database, {
      createIdempotencyId: () => '40000000-0000-4000-8000-000000000004',
      assertAdmin: async () => 'PLATFORM_OWNER',
    })
    const request = {
      catalogId: CATALOG_ID,
      expectedVersion: 1,
      status: 'UNPUBLISHED',
      idempotencyKey: 'game-catalog-recovery-0001',
    }

    await assert.rejects(repository.adminChangeBlindBoxCatalogStatus(caller, request), /INJECTED_FAILURE/)
    assert.equal(database.snapshot().catalog.status, 'PUBLISHED')
    assert.equal(database.snapshot().catalog.version, 1)
    assert.equal(database.snapshot().idempotency.size, 0)

    const recovered = await repository.adminChangeBlindBoxCatalogStatus(caller, request)
    assert.equal(recovered.idempotent, false)
    assert.equal(database.snapshot().catalog.status, 'UNPUBLISHED')
    assert.equal(database.snapshot().idempotency.size, 1)
  })

  it('fails closed on an incomplete durable record without running the business mutation', async () => {
    const request = { seasonId: SEASON_ID, expectedVersion: 1, status: 'CLOSED' }
    let workCalls = 0
    const database = {
      async transaction(work) {
        return work({
          async query() {
            const error = new Error('duplicate')
            error.code = 'ER_DUP_ENTRY'
            throw error
          },
          async one() {
            return {
              request_hash: requestHash(request),
              status: 'RUNNING',
              response_json: null,
            }
          },
        })
      },
    }

    await assert.rejects(
      gameAdminMutation(database, {
        caller,
        operation: 'mip.admin.game.seasons.changeStatus',
        idempotencyKey: 'game-incomplete-record-0001',
        request,
        authorize: async () => 'PLATFORM_OWNER',
        work: async () => { workCalls += 1; return {} },
      }),
      error => error.code === 'CONFLICT',
    )
    assert.equal(workCalls, 0)
  })
})

function transactionalGameDatabase(options = {}) {
  let failAuditCount = Number(options.failAuditCount || 0)
  let state = {
    auditCount: 0,
    idempotency: new Map(),
    season: {
      id: SEASON_ID,
      season_key: '2030-h1',
      name: '2030 上半年赛季',
      summary: '',
      rules_text: '规则',
      rules_json: '{}',
      period_kind: 'HALF_YEAR',
      starts_at: '2030-01-01T00:00:00.000Z',
      ends_at: '2030-06-30T23:59:59.000Z',
      status: 'ACTIVE',
      version: 1,
    },
    catalog: {
      id: CATALOG_ID,
      status: 'PUBLISHED',
      version: 1,
      pity_min_rarity: 'RARE',
    },
  }

  return {
    snapshot: () => cloneState(state),
    async transaction(work) {
      const pending = cloneState(state)
      const tx = {
        async one(sql, params = []) {
          if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
          if (sql.includes('FROM mip_idempotency_keys')) {
            return pending.idempotency.get(idempotencyIndex(params[0], params[1], params[2], params[3])) || null
          }
          if (sql.includes('FROM mip_game_seasons')) return { ...pending.season }
          if (sql.includes('FROM mip_blind_box_catalogs')) return { ...pending.catalog }
          throw new Error(`unexpected one: ${sql}`)
        },
        async query(sql, params = []) {
          if (sql.includes('INSERT INTO mip_idempotency_keys')) {
            const index = idempotencyIndex(params[1], params[2], params[3], params[4])
            if (pending.idempotency.has(index)) {
              const error = new Error('duplicate')
              error.code = 'ER_DUP_ENTRY'
              throw error
            }
            pending.idempotency.set(index, {
              id: params[0],
              request_hash: params[5],
              status: 'RUNNING',
              response_json: null,
            })
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_idempotency_keys')) {
            const record = [...pending.idempotency.values()].find(item => item.id === params[2])
            if (!record || record.request_hash !== params[3] || record.status !== 'RUNNING') {
              return { affectedRows: 0 }
            }
            record.status = 'COMPLETED'
            record.response_json = params[0]
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_game_seasons SET status')) {
            if (pending.season.version !== Number(params[4])) return { affectedRows: 0 }
            pending.season.status = params[0]
            pending.season.version += 1
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_blind_box_catalogs') && sql.includes('SET status')) {
            if (pending.catalog.version !== Number(params[4])) return { affectedRows: 0 }
            pending.catalog.status = params[0]
            pending.catalog.version += 1
            return { affectedRows: 1 }
          }
          if (sql.includes('INSERT INTO mip_audit_logs')) {
            if (failAuditCount > 0) {
              failAuditCount -= 1
              throw new Error('INJECTED_FAILURE')
            }
            pending.auditCount += 1
            return { affectedRows: 1 }
          }
          if (sql.includes('SELECT id, rarity FROM mip_blind_box_cards')) return []
          throw new Error(`unexpected query: ${sql}`)
        },
      }
      try {
        const result = await work(tx)
        state = pending
        return result
      }
      catch (error) {
        throw error
      }
    },
  }
}

function idempotencyIndex(appId, userId, operation, key) {
  return [appId, userId, operation, key].join('\0')
}

function cloneState(value) {
  return {
    auditCount: value.auditCount,
    idempotency: new Map([...value.idempotency].map(([key, record]) => [key, { ...record }])),
    season: { ...value.season },
    catalog: { ...value.catalog },
  }
}
