'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { describe, it } = require('node:test')

const APP_ID = 'wx1111111111111111'
const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZER_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'

function loadPrivateAdminSaveEvent() {
  const filename = require.resolve('../domain/event-service')
  const source = `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__testAdminSaveEvent = adminSaveEvent\n`
  const testModule = new Module(filename)
  testModule.filename = filename
  testModule.paths = Module._nodeModulePaths(path.dirname(filename))
  testModule._compile(source, filename)
  return testModule.exports.__testAdminSaveEvent
}

const adminSaveEvent = loadPrivateAdminSaveEvent()

function eventDraft(eventTypeKey) {
  return {
    scopeType: 'PLATFORM',
    title: '活动标题',
    summary: '活动摘要',
    description: '活动介绍',
    eventTypeKey,
    mode: 'OFFLINE',
    venueName: '活动场地',
    startsAt: '2030-08-26T10:00:00.000Z',
    endsAt: '2030-08-26T12:00:00.000Z',
    accessType: 'FREE',
    registrationPolicy: 'AUTO',
  }
}

function fixture({ existing = null, eventTypeInsertError = null, eventTypeRow = { id: 'type-1' } } = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('SELECT * FROM mip_events')) return existing
      if (sql.includes('SELECT id FROM mip_event_types')) return eventTypeRow
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return [{ scope_type: 'PLATFORM', scope_id: null, role_key: 'PLATFORM_OWNER' }]
      }
      if (sql.includes('INSERT INTO mip_event_types') && eventTypeInsertError) {
        throw eventTypeInsertError
      }
      return { affectedRows: 1 }
    },
  }
  const db = {
    async transaction(work) {
      calls.push({ kind: 'transaction' })
      return work(tx)
    },
  }
  return { calls, db }
}

function catalogInsert(calls) {
  return calls.find(call => call.sql?.includes('INSERT INTO mip_event_types'))
}

function eventWrite(calls) {
  return calls.find(call => /^\s*(?:INSERT INTO|UPDATE) mip_events\b/.test(call.sql || ''))
}

describe('MIP public event service event-type FK safety', () => {
  it('ensures a missing AppID-bound type with the creating operator before event insert', async () => {
    const { calls, db } = fixture()
    await adminSaveEvent(db, {
      appId: APP_ID,
      userId: ACTOR_ID,
      draft: eventDraft('community'),
      contentSafetyStatus: 'PASSED',
    })

    const catalog = catalogInsert(calls)
    const event = eventWrite(calls)
    assert.ok(catalog)
    assert.ok(event)
    assert.ok(calls.indexOf(catalog) < calls.indexOf(event))
    assert.equal(calls.filter(call => call.kind === 'transaction').length, 1)
    assert.match(catalog.sql, /SELECT \?, \?, \?, \?, '', 0, 'ACTIVE', 1, \?, \?/)
    assert.match(catalog.sql, /WHERE NOT EXISTS \([\s\S]*existing\.app_id = \? AND existing\.type_key = \?/)
    assert.doesNotMatch(catalog.sql, /INSERT IGNORE|ON DUPLICATE KEY UPDATE|UPDATE mip_event_types/i)
    assert.deepEqual(catalog.params.slice(1), [
      APP_ID, 'community', 'community', ACTOR_ID, ACTOR_ID, APP_ID, 'community',
    ])
    assert.match(event.sql, /^INSERT INTO mip_events/)
  })

  it('uses the current operator and ensures the type before event update', async () => {
    const { calls, db } = fixture({
      existing: {
        id: EVENT_ID,
        organizer_user_id: ORGANIZER_ID,
        branch_id: null,
        status: 'DRAFT',
        version: 4,
      },
    })
    await adminSaveEvent(db, {
      appId: APP_ID,
      userId: ACTOR_ID,
      eventId: EVENT_ID,
      expectedVersion: 4,
      draft: eventDraft('workshop'),
      contentSafetyStatus: 'PASSED',
    })

    const catalog = catalogInsert(calls)
    const event = eventWrite(calls)
    assert.ok(catalog)
    assert.ok(event)
    assert.ok(calls.indexOf(catalog) < calls.indexOf(event))
    assert.deepEqual(catalog.params.slice(1), [
      APP_ID, 'workshop', 'workshop', ACTOR_ID, ACTOR_ID, APP_ID, 'workshop',
    ])
    assert.match(event.sql, /^UPDATE mip_events SET/)
  })

  it('defaults a missing or empty type key but rejects explicit unstable keys before opening a transaction', async () => {
    for (const eventTypeKey of [undefined, '', '   ']) {
      const { calls, db } = fixture()
      const draft = eventDraft(eventTypeKey)
      await adminSaveEvent(db, {
        appId: APP_ID,
        userId: ACTOR_ID,
        draft,
        contentSafetyStatus: 'PASSED',
      })
      assert.equal(catalogInsert(calls).params[2], 'community')
    }

    for (const eventTypeKey of ['bad key', 'x'.repeat(65), 42]) {
      const { calls, db } = fixture()
      await assert.rejects(
        adminSaveEvent(db, {
          appId: APP_ID,
          userId: ACTOR_ID,
          draft: eventDraft(eventTypeKey),
          contentSafetyStatus: 'PASSED',
        }),
        error => error.code === 'VALIDATION_FAILED',
      )
      assert.deepEqual(calls, [])
    }
  })

  it('continues only when an ER_DUP_ENTRY race resolves to the same AppID-bound type', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
    const { calls, db } = fixture({ eventTypeInsertError: duplicate })
    await adminSaveEvent(db, {
      appId: APP_ID,
      userId: ACTOR_ID,
      draft: eventDraft('community'),
      contentSafetyStatus: 'PASSED',
    })

    const verification = calls.find(call => call.sql?.includes('SELECT id FROM mip_event_types'))
    assert.deepEqual(verification?.params, [APP_ID, 'community'])
    assert.ok(eventWrite(calls))
  })

  it('rethrows non-duplicate failures and duplicate errors without the expected type', async () => {
    for (const eventTypeInsertError of [
      Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' }),
      Object.assign(new Error('wrong duplicate'), { code: 'ER_DUP_ENTRY' }),
    ]) {
      const { calls, db } = fixture({
        eventTypeInsertError,
        eventTypeRow: eventTypeInsertError.code === 'ER_DUP_ENTRY' ? null : { id: 'type-1' },
      })
      await assert.rejects(
        adminSaveEvent(db, {
          appId: APP_ID,
          userId: ACTOR_ID,
          draft: eventDraft('community'),
          contentSafetyStatus: 'PASSED',
        }),
        error => error === eventTypeInsertError,
      )
      assert.equal(eventWrite(calls), undefined)
    }
  })
})
