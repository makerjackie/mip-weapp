'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createKnowledgeSchedulingRepository,
  roundedWakeAt,
} = require('../domain/knowledge-scheduling-repository')

const APP_ID = 'wx0123456789abcdef'
const SCHEDULE_ID = '30000000-0000-4000-8000-000000000001'
const SOURCE_ID = '10000000-0000-4000-8000-000000000001'
const CATEGORY_ID = '20000000-0000-4000-8000-000000000001'
const USER_ID = '40000000-0000-4000-8000-000000000001'
const NOW = new Date('2030-08-25T00:45:00.000Z')

function databaseWithTransaction(handler) {
  return {
    async one() { return null },
    async query() { return [] },
    async transaction(work) {
      return work({
        one: (sql, params) => handler('one', sql, params),
        query: (sql, params) => handler('query', sql, params),
      })
    },
  }
}

describe('knowledge scheduling repository', () => {
  it('rounds a millisecond wake up instead of firing before the durable due instant', () => {
    assert.equal(
      roundedWakeAt('2030-08-25T00:30:00.123Z'),
      '2030-08-25T00:30:01.000Z',
    )
  })

  it('claims no more than three due sources with a bounded lease and incremented attempt', async () => {
    const writes = []
    const database = databaseWithTransaction(async (kind, sql, params) => {
      if (kind === 'query' && sql.includes('leased_until <= ?') && sql.includes('SELECT id')) return []
      if (kind === 'query' && sql.includes('FROM mip_knowledge_ingestion_schedules schedule')) {
        return [{
          attempt_count: 0,
          category_id: CATEGORY_ID,
          configured_by_user_id: USER_ID,
          daily_time: '08:30',
          endpoint_url: 'https://example.com/feed',
          fetch_config_json: '{}',
          id: SCHEDULE_ID,
          next_run_at: new Date('2030-08-25T00:30:00.000Z'),
          source_id: SOURCE_ID,
          source_type: 'JSON_FEED',
          timezone: 'Asia/Shanghai',
          version: 1,
        }]
      }
      if (kind === 'query' && sql.includes('UPDATE mip_knowledge_ingestion_schedules')) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      }
      return []
    })
    const repository = createKnowledgeSchedulingRepository(database, {
      leaseToken: () => 'a'.repeat(64),
      now: () => NOW,
    })
    const result = await repository.claimDue({ appId: APP_ID, limit: 3 })
    assert.equal(result.claims.length, 1)
    assert.equal(result.claims[0].attempt, 1)
    assert.equal(result.claims[0].version, 2)
    assert.equal(result.claims[0].leasedUntil.toISOString(), '2030-08-25T00:47:00.000Z')
    assert.equal(writes[0].params[0], 1)
  })

  it('backs off an expired lease for fifteen minutes before reclaiming it', async () => {
    const writes = []
    const database = databaseWithTransaction(async (kind, sql, params) => {
      if (kind === 'query' && sql.includes('SELECT id, daily_time, timezone')) {
        return [{
          attempt_count: 1,
          daily_time: '08:30',
          id: SCHEDULE_ID,
          timezone: 'Asia/Shanghai',
          version: 4,
        }]
      }
      if (kind === 'query' && sql.includes('UPDATE mip_knowledge_ingestion_schedules')) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      }
      if (kind === 'query' && sql.includes('FROM mip_knowledge_ingestion_schedules schedule')) {
        return []
      }
      return []
    })
    const repository = createKnowledgeSchedulingRepository(database, { now: () => NOW })
    const result = await repository.claimDue({ appId: APP_ID, limit: 3 })
    assert.equal(result.reconciled, 1)
    assert.equal(result.claims.length, 0)
    assert.equal(writes[0].params[0].toISOString(), '2030-08-25T01:00:00.000Z')
    assert.equal(writes[0].params[1], 1)
  })

  it('moves the third failed attempt to the next local day and clears the exact lease', async () => {
    const writes = []
    const schedule = {
      app_id: APP_ID,
      attempt_count: 3,
      category_id: CATEGORY_ID,
      configured_by_user_id: USER_ID,
      daily_time: '08:30',
      id: SCHEDULE_ID,
      lease_due_at: new Date('2030-08-25T00:30:00.000Z'),
      lease_token: 'b'.repeat(64),
      leased_until: new Date('2030-08-25T00:47:00.000Z'),
      source_id: SOURCE_ID,
      status: 'ACTIVE',
      timezone: 'Asia/Shanghai',
      version: 2,
    }
    const database = databaseWithTransaction(async (kind, sql, params) => {
      if (kind === 'one' && sql.includes('schedule.*')) return schedule
      if (kind === 'one' && sql.includes('mip_knowledge_ingestion_runs')) return null
      if (kind === 'query') {
        writes.push({ sql, params })
        if (sql.includes('UPDATE mip_knowledge_ingestion_schedules')) return { affectedRows: 1 }
        return { affectedRows: 1 }
      }
      return null
    })
    const repository = createKnowledgeSchedulingRepository(database, {
      id: () => '50000000-0000-4000-8000-000000000001',
      now: () => NOW,
    })
    const result = await repository.completeFailure({
      appId: APP_ID,
      leaseToken: schedule.lease_token,
      scheduleId: SCHEDULE_ID,
      version: 2,
    }, 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
    assert.equal(result.retryDisposition, 'NEXT_DAY')
    assert.equal(result.nextRunAt, '2030-08-26T00:30:00.000Z')
    const scheduleWrite = writes.find(call => call.sql.includes('UPDATE mip_knowledge_ingestion_schedules'))
    assert.equal(scheduleWrite.params[1], 0)
    assert.equal(scheduleWrite.params.at(-1), schedule.lease_token)
  })
})
