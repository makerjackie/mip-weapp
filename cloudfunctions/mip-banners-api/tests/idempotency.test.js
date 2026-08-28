'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { claimOptional, complete } = require('../domain/idempotency')

const caller = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
}

test('claims and completes a Banner save idempotency record', async () => {
  const writes = []
  const tx = {
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const request = { bannerId: null, banner: { title: '活动主页头图' } }
  const claim = await claimOptional(
    tx,
    caller,
    'banner-save-request-0001',
    'mip.admin.banners.save',
    request,
    () => '20000000-0000-4000-8000-000000000001',
  )
  assert.equal(claim.replay, null)
  assert.match(claim.requestHash, /^[a-f0-9]{64}$/)

  await complete(
    tx,
    caller,
    'banner-save-request-0001',
    'mip.admin.banners.save',
    claim.requestHash,
    { id: '30000000-0000-4000-8000-000000000001', version: 1 },
  )
  assert.match(writes[0].sql, /INSERT INTO mip_idempotency_keys/)
  assert.match(writes[1].sql, /status = 'COMPLETED'/)
})

test('replays only a completed response with the same request hash', async () => {
  const request = { bannerId: null, banner: { title: '活动主页头图' } }
  let storedHash = ''
  const firstTx = {
    async query(_sql, params) {
      storedHash = params[5]
      return { affectedRows: 1 }
    },
  }
  await claimOptional(
    firstTx,
    caller,
    'banner-save-request-0001',
    'mip.admin.banners.save',
    request,
    () => '20000000-0000-4000-8000-000000000001',
  )

  const replayTx = {
    async query() {
      const error = new Error('duplicate')
      error.code = 'ER_DUP_ENTRY'
      throw error
    },
    async one() {
      return {
        request_hash: storedHash,
        status: 'COMPLETED',
        response_json: JSON.stringify({
          id: '30000000-0000-4000-8000-000000000001',
          version: 1,
        }),
      }
    },
  }
  const replay = await claimOptional(
    replayTx,
    caller,
    'banner-save-request-0001',
    'mip.admin.banners.save',
    request,
    () => 'unused',
  )
  assert.deepEqual(replay.replay, {
    id: '30000000-0000-4000-8000-000000000001',
    version: 1,
    idempotent: true,
  })

  await assert.rejects(
    claimOptional(
      replayTx,
      caller,
      'banner-save-request-0001',
      'mip.admin.banners.save',
      { ...request, banner: { title: '不同内容' } },
      () => 'unused',
    ),
    error => error.code === 'CONFLICT',
  )
})
