'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createEventDrafts } = require('../domain/event-drafts')
const { createEventDraftRepository } = require('../domain/repositories/event-drafts')
const { createAdminMediaProjection } = require('../lib/admin-media-projection')

const APP = 'test-app'
const ACTOR = '10000000-0000-4000-8000-000000000001'
const EVENT = '10000000-0000-4000-8000-000000000002'
const SOURCE = '10000000-0000-4000-8000-000000000003'
const COVER = '20000000-0000-4000-8000-000000000001'
const CONTENT = '20000000-0000-4000-8000-000000000002'
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
const dependencies = {
  lockMutationAuthorization: async () => grant,
  assertMutationScope: () => {}, assertAuthorizedScope: () => {}, eventScopeFromRow: () => ({}),
  writeAudit: async () => {}, createId: () => 'id-1',
  repositorySupport: { codeError: code => Object.assign(new Error(code), { code }),
    iso: value => value, json: value => JSON.parse(value) },
}

it('saves stable asset IDs and reads fresh owner-scoped previews without changing the stored draft', async () => {
  let row
  const database = {
    async one(sql, params) {
      assert.match(sql, /FROM mip_event_drafts/)
      assert.deepEqual(params, [APP, ACTOR, '7'])
      return row
    },
    async query(sql, params) {
      if (sql.includes('INSERT INTO mip_event_drafts')) {
        row = { draft_id: 7, event_uid: null, draft_data_json: params.at(-1), version: 1, updated_at: '2026-10-22' }
        return { insertId: 7 }
      }
      assert.match(sql, /asset\.app_id = \? AND asset\.status = 'READY'/)
      assert.match(sql, /asset\.purpose = 'EVENT_COVER'/)
      assert.match(sql, /asset\.purpose = 'EVENT_CONTENT'/)
      assert.equal((sql.match(/asset\.owner_user_id = \?/g) || []).length, 2)
      assert.equal((sql.match(/AND FALSE/g) || []).length, 2, 'new drafts cannot read somebody else\'s event media')
      assert.deepEqual(params, [APP, COVER, CONTENT, COVER, ACTOR, CONTENT, ACTOR])
      return [{ id: COVER, cloud_file_id: 'cloud://cover' }, { id: CONTENT, cloud_file_id: 'cloud://body' }]
    },
    async transaction(run) { return run(database) },
  }
  const repository = createEventDraftRepository(database, dependencies)
  const dataJson = JSON.stringify({ title: '待继续填写', coverAssetId: COVER, contentMedia: [{ assetId: CONTENT, caption: '图注' }] })
  await repository.saveEventDraft({ appId: APP, actorUserId: ACTOR, eventId: null, dataJson, audit: () => ({}) })
  const service = createEventDrafts({ repository, access: {
    session: async () => ({ caller: { appId: APP, userId: ACTOR }, bindings: [grant] }),
  } })
  const project = createAdminMediaProjection({ getTempFileURL: async ({ fileList }) => {
    assert.deepEqual(fileList, ['cloud://cover', 'cloud://body'])
    return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: `https://media.example/${fileID.slice(8)}?sign=fresh` })) }
  } })
  const result = await project(await service.getEventDraft({}, { draftId: '7' }))
  assert.deepEqual(result.mediaPreviews, [
    { assetId: COVER, imageUrl: 'https://media.example/cover?sign=fresh' },
    { assetId: CONTENT, imageUrl: 'https://media.example/body?sign=fresh' },
  ])
  assert.equal(row.draft_data_json, dataJson)
  assert.deepEqual(result.draftData, JSON.parse(dataJson))
})

it('checks existing event-read access for both edited and cloned event before media lookup', async () => {
  const checked = []
  let allow = false
  let reads = 0
  const draft = { draftId: '7', eventId: EVENT, draftData: { cloneSourceEventId: SOURCE, coverAssetId: COVER } }
  const service = createEventDrafts({ access: {
    session: async () => ({ caller: { appId: APP, userId: ACTOR }, bindings: [grant] }),
    eventAuthorization: async (_, id, capability) => {
      checked.push([id, capability])
      if (id === SOURCE && !allow) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    },
  }, repository: {
    getEventDraft: async () => draft,
    getEventDraftMedia: async (...args) => { reads += 1; assert.deepEqual(args, [APP, ACTOR, draft.draftData, [EVENT, SOURCE]]); return [] },
  } })
  await assert.rejects(service.getEventDraft({}), error => error.code === 'FORBIDDEN')
  assert.equal(reads, 0)
  assert.deepEqual(checked, [[EVENT, 'events.read'], [SOURCE, 'events.read']])
  allow = true
  assert.deepEqual((await service.getEventDraft({})).mediaPreviews, [])
  assert.equal(reads, 1)
})

it('only allows bound media from explicitly authorized events and returns no guessed or unready asset', async () => {
  const repository = createEventDraftRepository({ query: async (sql, params) => {
    assert.match(sql, /evt\.app_id = asset\.app_id AND evt\.cover_asset_id = asset\.id/)
    assert.match(sql, /media\.app_id = asset\.app_id AND media\.media_asset_id = asset\.id/)
    assert.match(sql, /media\.status = 'ACTIVE' AND evt\.id IN \(\?, \?\)/)
    assert.deepEqual(params, [APP, COVER, CONTENT, COVER, ACTOR, EVENT, SOURCE, CONTENT, ACTOR, EVENT, SOURCE])
    return []
  } }, dependencies)
  assert.deepEqual(await repository.getEventDraftMedia(APP, ACTOR,
    { coverAssetId: COVER, contentMedia: [{ assetId: CONTENT }] }, [EVENT, SOURCE]), [])
  assert.deepEqual(await repository.getEventDraftMedia(APP, ACTOR,
    { coverAssetId: 'cloud://not-an-asset-id', contentMedia: [null, { assetId: 'invalid' }] }), [])
})
