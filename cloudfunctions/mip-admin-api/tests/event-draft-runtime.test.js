'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createEventDrafts } = require('../domain/event-drafts')
const { createEventDraftRepository } = require('../domain/repositories/event-drafts')

const APP = 'test-app'
const ACTOR = '10000000-0000-4000-8000-000000000001'
const EVENT = '10000000-0000-4000-8000-000000000002'
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }

it('requires a session and event-write grant before storing a private draft', async () => {
  const saved = []
  let grantAllowed = false
  const access = {
    session: async () => ({ caller: { appId: APP, userId: ACTOR }, bindings: grantAllowed ? [grant] : [] }),
    mutationAuthorization: () => ({ grant }),
    audit: (_, __, value) => value,
  }
  const drafts = createEventDrafts({ access, repository: {
    saveEventDraft: async input => { saved.push(input); return { draftId: '7' } },
  } })
  const input = { draftData: { title: '尚未完成的活动' }, idempotencyKey: 'draft-1' }
  await assert.rejects(drafts.saveEventDraft({}, input), error => error.code === 'FORBIDDEN')
  assert.equal(saved.length, 0)
  grantAllowed = true
  assert.deepEqual(await drafts.saveEventDraft({}, input), { draftId: '7' })
  assert.equal(saved[0].appId, APP)
  assert.equal(saved[0].actorUserId, ACTOR)
  assert.equal(saved[0].eventId, null)
  await assert.rejects(drafts.saveEventDraft({}, { ...input, draftData: [] }), error => error.code === 'VALIDATION_FAILED')
})

it('rechecks event access before returning an older linked draft', async () => {
  const checked = []
  const drafts = createEventDrafts({
    access: {
      session: async () => ({ caller: { appId: APP, userId: ACTOR }, bindings: [grant] }),
      eventAuthorization: async (_, eventId, capability) => { checked.push([eventId, capability]); throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' }) },
    },
    repository: { getEventDraft: async () => ({ draftId: '7', eventId: EVENT, draftData: { title: 'secret' } }) },
  })
  await assert.rejects(drafts.getEventDraft({}), error => error.code === 'FORBIDDEN')
  assert.deepEqual(checked, [[EVENT, 'events.read']])
})

it('updates only the authenticated operator’s tenant-scoped draft', async () => {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_event_drafts')) return { draft_id: 7, event_uid: null, version: 2 }
      return null
    },
    async query(sql, params) { calls.push({ sql, params }); return { affectedRows: 1 } },
  }
  const repository = createEventDraftRepository({ transaction: fn => fn(tx) }, {
    lockMutationAuthorization: async () => grant,
    assertMutationScope: () => {},
    assertAuthorizedScope: () => {},
    eventScopeFromRow: () => ({}),
    writeAudit: async (_, audit) => calls.push({ audit }),
    createId: () => 'id-1',
    repositorySupport: { codeError: code => Object.assign(new Error(code), { code }),
      iso: value => value, json: value => JSON.parse(value) },
  })
  const result = await repository.saveEventDraft({ appId: APP, actorUserId: ACTOR,
    draftId: '7', eventId: null, dataJson: '{"title":"A"}', audit: draftId => ({ draftId }) })
  assert.deepEqual(result, { draftId: '7', eventId: null, version: 3 })
  const update = calls.find(call => call.sql?.includes('UPDATE mip_event_drafts'))
  assert.match(update.sql, /app_id = \? AND operator_user_id = \? AND draft_id = \? AND version = \?/)
  assert.deepEqual(update.params.slice(1), [APP, ACTOR, '7', 2])
})
