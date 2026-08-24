'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertEventContentMedia,
  replaceEventContentMedia,
} = require('../domain/repository')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const MEDIA_IDS = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
]

function input() {
  return {
    appId: APP_ID,
    actorUserId: USER_ID,
    draft: {
      contentMedia: MEDIA_IDS.map((assetId, index) => ({
        assetId,
        caption: `图片 ${index + 1}`,
      })),
    },
  }
}

describe('admin event content media', () => {
  it('accepts only app-scoped ready EVENT_CONTENT assets owned by the operator or already bound', async () => {
    const tx = {
      async query(sql, params) {
        assert.match(sql, /purpose = 'EVENT_CONTENT'/)
        assert.match(sql, /asset\.owner_user_id = \? OR current_media\.event_id IS NOT NULL/)
        assert.deepEqual(params, [EVENT_ID, APP_ID, ...MEDIA_IDS, USER_ID])
        return MEDIA_IDS.map(id => ({ id }))
      },
    }
    await assertEventContentMedia(tx, input(), EVENT_ID)
  })

  it('replaces ordered media inside the event save transaction', async () => {
    const calls = []
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    await replaceEventContentMedia(tx, input(), EVENT_ID)
    assert.match(calls[0].sql, /UPDATE mip_event_content_media/)
    assert.match(calls[0].sql, /status = 'REMOVED'/)
    assert.deepEqual(calls[0].params, [APP_ID, EVENT_ID])
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[1].params, [APP_ID, EVENT_ID, MEDIA_IDS[0], 0, '图片 1'])
    assert.deepEqual(calls[2].params, [APP_ID, EVENT_ID, MEDIA_IDS[1], 1, '图片 2'])
    assert.match(calls[1].sql, /ON DUPLICATE KEY UPDATE/)
  })

  it('rejects a partial asset lookup before changing relationships', async () => {
    const tx = {
      async query() {
        return [{ id: MEDIA_IDS[0] }]
      },
    }
    await assert.rejects(
      () => assertEventContentMedia(tx, input(), EVENT_ID),
      error => error.code === 'VALIDATION_FAILED',
    )
  })
})
