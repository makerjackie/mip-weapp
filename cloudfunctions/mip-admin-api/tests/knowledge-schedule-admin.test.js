'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const { createKnowledgeAdminService } = require('../domain/knowledge')

const APP_ID = 'wx0123456789abcdef'
const USER_ID = '40000000-0000-4000-8000-000000000001'
const SOURCE_ID = '10000000-0000-4000-8000-000000000001'
const CATEGORY_ID = '20000000-0000-4000-8000-000000000001'
const SCHEDULE_ID = '30000000-0000-4000-8000-000000000001'
const caller = { appId: APP_ID, identityKey: 'wechat-open-id' }

describe('knowledge schedule administration', () => {
  it('requires expectedVersion zero and a stable idempotency key for a new plan', async () => {
    const writes = []
    const ids = [
      '50000000-0000-4000-8000-000000000001',
      SCHEDULE_ID,
    ]
    const roles = [{
      role_key: 'PLATFORM_OPERATIONS',
      scope_id: null,
      scope_type: 'PLATFORM',
    }]
    const tx = {
      async one(sql) {
        if (sql.includes('mip_knowledge_sources')) {
          return { id: SOURCE_ID, source_type: 'JSON_FEED', status: 'ACTIVE' }
        }
        if (sql.includes('mip_knowledge_categories')) {
          return { id: CATEGORY_ID, status: 'ACTIVE' }
        }
        return null
      },
      async query(sql, params) {
        if (sql.includes('mip_admin_role_bindings')) return roles
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const fullAccessPolicy = {
      async loadByIdentity() {
        return {
          agreementsAccepted: true,
          id: USER_ID,
          phoneBound: true,
          profileComplete: true,
          status: 'ACTIVE',
        }
      },
    }
    const database = {
      async one() { return null },
      async query(sql) { return sql.includes('mip_admin_role_bindings') ? roles : [] },
      async transaction(work) { return work(tx) },
    }
    const service = createKnowledgeAdminService(database, {
      fullAccessPolicy,
      id: () => ids.shift(),
      now: () => new Date('2030-08-25T00:00:00.000Z'),
    })
    const input = {
      categoryId: CATEGORY_ID,
      dailyTime: '08:30',
      expectedVersion: 0,
      idempotencyKey: 'knowledge-schedule-create-0001',
      sourceId: SOURCE_ID,
      status: 'ACTIVE',
      timeZone: 'Asia/Shanghai',
    }
    const result = await service.saveKnowledgeSchedule(caller, input)
    assert.deepEqual(result, {
      dailyTime: '08:30',
      id: SCHEDULE_ID,
      idempotent: false,
      nextRunAt: '2030-08-25T00:30:00.000Z',
      status: 'ACTIVE',
      timeZone: 'Asia/Shanghai',
      version: 1,
    })
    assert.ok(writes.some(call => call.sql.includes('INSERT INTO mip_idempotency_keys')))
    assert.ok(writes.some(call => call.sql.includes('INSERT INTO mip_knowledge_ingestion_schedules')))
    assert.ok(writes.some(call => call.sql.includes("status = 'COMPLETED'")))

    await assert.rejects(() => service.saveKnowledgeSchedule(caller, {
      ...input,
      expectedVersion: 1,
      idempotencyKey: 'knowledge-schedule-create-0002',
    }), /VALIDATION_FAILED/)
    await assert.rejects(() => service.saveKnowledgeSchedule(caller, {
      ...input,
      idempotencyKey: 'knowledge-schedule-create-0003',
      status: 'UNKNOWN',
    }), /VALIDATION_FAILED/)
    await assert.rejects(() => service.listKnowledgeSchedules(caller, {
      limit: 0,
      status: 'UNKNOWN',
    }), /VALIDATION_FAILED/)
    await assert.rejects(() => service.listKnowledgeSchedules(caller, {
      limit: 0,
      status: 'ACTIVE',
    }), /VALIDATION_FAILED/)
  })

  it('lists only app-scoped plans with source, category, execution, and version facts', async () => {
    const queries = []
    const database = {
      async one() { return null },
      async query(sql, params) {
        if (sql.includes('mip_admin_role_bindings')) {
          return [{ role_key: 'PLATFORM_OPERATIONS', scope_id: null, scope_type: 'PLATFORM' }]
        }
        queries.push({ sql, params })
        return [{
          attempt_count: 2,
          category_id: CATEGORY_ID,
          category_name: '行业热点',
          category_status: 'ACTIVE',
          daily_time: '08:30',
          id: SCHEDULE_ID,
          last_completed_at: new Date('2030-08-24T00:31:00.000Z'),
          last_error_code: 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE',
          last_run_id: '50000000-0000-4000-8000-000000000001',
          last_started_at: new Date('2030-08-25T00:30:00.000Z'),
          next_run_at: new Date('2030-08-25T00:45:00.000Z'),
          source_id: SOURCE_ID,
          source_name: '示例热点源',
          source_status: 'ACTIVE',
          source_type: 'RSS',
          status: 'ACTIVE',
          timezone: 'Asia/Shanghai',
          version: 7,
        }]
      },
      async transaction() { throw new Error('NOT_EXPECTED') },
    }
    const service = createKnowledgeAdminService(database, {
      fullAccessPolicy: {
        async loadByIdentity() {
          return {
            agreementsAccepted: true,
            id: USER_ID,
            phoneBound: true,
            profileComplete: true,
            status: 'ACTIVE',
          }
        },
      },
    })
    const result = await service.listKnowledgeSchedules(caller, { limit: 20, status: 'ACTIVE' })
    assert.equal(queries[0].params[0], APP_ID)
    assert.deepEqual(queries[0].params.slice(1), ['ACTIVE', 'ACTIVE', 20])
    assert.deepEqual(result, {
      items: [{
        attemptCount: 2,
        category: { id: CATEGORY_ID, name: '行业热点', status: 'ACTIVE' },
        dailyTime: '08:30',
        id: SCHEDULE_ID,
        lastCompletedAt: '2030-08-24T00:31:00.000Z',
        lastErrorCode: 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE',
        lastRunId: '50000000-0000-4000-8000-000000000001',
        lastStartedAt: '2030-08-25T00:30:00.000Z',
        nextRunAt: '2030-08-25T00:45:00.000Z',
        source: {
          id: SOURCE_ID,
          name: '示例热点源',
          sourceType: 'RSS',
          status: 'ACTIVE',
        },
        status: 'ACTIVE',
        timeZone: 'Asia/Shanghai',
        version: 7,
      }],
      nextCursor: null,
    })
  })

  it('replays a completed save only when the same idempotency key has the same request hash', async () => {
    const input = {
      categoryId: CATEGORY_ID,
      dailyTime: '08:30',
      expectedVersion: 0,
      idempotencyKey: 'knowledge-schedule-create-0004',
      sourceId: SOURCE_ID,
      status: 'ACTIVE',
      timeZone: 'Asia/Shanghai',
    }
    const requestHash = createHash('sha256').update(JSON.stringify({
      categoryId: CATEGORY_ID,
      dailyTime: '08:30',
      expectedVersion: 0,
      idempotencyKey: input.idempotencyKey,
      scheduleId: null,
      sourceId: SOURCE_ID,
      status: 'ACTIVE',
      timeZone: 'Asia/Shanghai',
    })).digest('hex')
    const response = {
      dailyTime: '08:30',
      id: SCHEDULE_ID,
      idempotent: false,
      nextRunAt: '2030-08-25T00:30:00.000Z',
      status: 'ACTIVE',
      timeZone: 'Asia/Shanghai',
      version: 1,
    }
    const roles = [{ role_key: 'PLATFORM_OPERATIONS', scope_id: null, scope_type: 'PLATFORM' }]
    const transactionQueries = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) {
          return { request_hash: requestHash, response_json: JSON.stringify(response), status: 'COMPLETED' }
        }
        throw new Error('NOT_EXPECTED')
      },
      async query(sql) {
        if (sql.includes('mip_admin_role_bindings')) return roles
        transactionQueries.push(sql)
        const error = new Error('ER_DUP_ENTRY')
        error.code = 'ER_DUP_ENTRY'
        throw error
      },
    }
    const service = createKnowledgeAdminService({
      async one() { return null },
      async query(sql) { return sql.includes('mip_admin_role_bindings') ? roles : [] },
      async transaction(work) { return work(tx) },
    }, {
      fullAccessPolicy: {
        async loadByIdentity() {
          return {
            agreementsAccepted: true,
            id: USER_ID,
            phoneBound: true,
            profileComplete: true,
            status: 'ACTIVE',
          }
        },
      },
    })
    assert.deepEqual(await service.saveKnowledgeSchedule(caller, input), {
      ...response,
      idempotent: true,
    })
    assert.equal(transactionQueries.length, 1)
  })
})
