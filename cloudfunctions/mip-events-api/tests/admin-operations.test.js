'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const { describe, it } = require('node:test')
const eventService = require('../domain/event-service')

const removedActions = [
  'mip.events.admin.save',
  'mip.events.admin.changeStatus',
  'mip.events.admin.undoCheckIn',
]

function loadHandlerWithDatabaseProbe() {
  const indexPath = require.resolve('../index')
  delete require.cache[indexPath]
  const metrics = { databaseFactories: 0, operations: [] }
  const database = {
    async one(sql) {
      metrics.operations.push({ kind: 'one', sql })
      return null
    },
    async query(sql) {
      metrics.operations.push({ kind: 'query', sql })
      return []
    },
    async transaction(work) {
      metrics.operations.push({ kind: 'transaction' })
      return work(this)
    },
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    getWXContext: () => ({ APPID: 'wx-app', OPENID: 'openid-1' }),
    init: () => {},
    openapi: {},
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return cloud
    }
    if (request === './lib/mysql' && parent?.filename === indexPath) {
      return {
        mysqlDatabase() {
          metrics.databaseFactories += 1
          return database
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return { handler: require(indexPath), metrics }
  }
  finally {
    Module._load = originalLoad
  }
}

describe('MIP event administration boundary', () => {
  it('rejects legacy mutation routes before resolving identity or touching MySQL', async () => {
    const { handler, metrics } = loadHandlerWithDatabaseProbe()

    for (const action of removedActions) {
      const result = await handler.main({
        action,
        eventId: 'event-1',
        registrationId: 'registration-1',
        expectedVersion: 1,
        status: 'CANCELLED',
        reason: '旧入口不得执行',
      })
      assert.deepEqual(result, {
        ok: false,
        error: { code: 'NOT_FOUND', message: '活动操作不存在', retryable: false },
      })
    }

    assert.equal(metrics.databaseFactories, 0)
    assert.deepEqual(metrics.operations, [])
  })

  it('does not export duplicate event mutation services', () => {
    assert.equal(eventService.adminSaveEvent, undefined)
    assert.equal(eventService.adminChangeEventStatus, undefined)
    assert.equal(eventService.adminUndoCheckIn, undefined)
  })

  it('lists feedback only after event capability and applies a stable rating cursor', async () => {
    const calls = []
    const db = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        if (sql.includes('FROM mip_events')) return { id: 'event-1', branch_id: 'branch-1' }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.includes('FROM mip_admin_role_bindings')) {
          return [{ scope_type: 'EVENT', scope_id: 'event-1', role_key: 'EVENT_MANAGER' }]
        }
        return [{
          id: '00000000-0000-4000-8000-000000000001',
          nickname: '林野',
          rating: 5,
          body: '活动安排清晰',
          answers_json: JSON.stringify({
            recommendation: 'RECOMMEND',
            roleKeys: ['connector'],
            joinIntent: 'JOIN_NOW',
            explorationMethods: ['COMMUNITY_CHAT'],
            rosterConsent: 'MATCH_OPPORTUNITIES',
          }),
          version: 1,
          submitted_at: new Date('2026-08-24T10:00:00.000Z'),
          updated_at: new Date('2026-08-24T10:00:00.000Z'),
        }, {
          id: '00000000-0000-4000-8000-000000000002',
          nickname: '周舟',
          rating: 5,
          body: '交流有效',
          answers_json: null,
          version: 2,
          submitted_at: new Date('2026-08-23T10:00:00.000Z'),
          updated_at: new Date('2026-08-23T10:00:00.000Z'),
        }]
      },
    }
    const result = await eventService.adminListFeedback(db, {
      appId: 'wx-app',
      userId: 'admin-1',
      eventId: 'event-1',
      rating: 5,
      limit: 1,
    })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].body, '活动安排清晰')
    assert.equal(result.items[0].answers.recommendation, 'RECOMMEND')
    assert.match(calls.at(-1).sql, /f\.answers_json/)
    assert.match(calls.at(-1).sql, /f\.rating = \?/)
    assert.equal(calls.at(-1).params[2], 5)
    assert.match(result.nextCursor, /^[A-Za-z0-9_-]+$/)
  })

  it('rejects malformed feedback cursors and ratings before querying feedback rows', async () => {
    let feedbackQuery = false
    const db = {
      async one() { return { id: 'event-1', branch_id: null } },
      async query(sql) {
        if (sql.includes('FROM mip_admin_role_bindings')) {
          return [{ scope_type: 'PLATFORM', scope_id: null, role_key: 'PLATFORM_OWNER' }]
        }
        feedbackQuery = true
        return []
      },
    }
    await assert.rejects(
      eventService.adminListFeedback(db, {
        appId: 'wx-app', userId: 'admin-1', eventId: 'event-1', rating: 6,
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      eventService.adminListFeedback(db, {
        appId: 'wx-app', userId: 'admin-1', eventId: 'event-1',
        cursor: Buffer.from(JSON.stringify({ submittedAt: 'bad', id: 'bad' })).toString('base64url'),
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(feedbackQuery, false)
  })
})
