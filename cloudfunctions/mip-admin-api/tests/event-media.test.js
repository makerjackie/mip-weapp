'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { assertEventCover } = require('../domain/repository')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const COVER_ID = '22222222-2222-4222-8222-222222222222'

describe('admin event cover authorization', () => {
  it('requires a newly selected cover to belong to the current operator', async () => {
    const tx = {
      async one(sql, params) {
        assert.match(sql, /owner_user_id = \?/)
        assert.match(sql, /purpose = 'EVENT_COVER'/)
        assert.match(sql, /status = 'READY'/)
        assert.deepEqual(params, [APP_ID, COVER_ID, USER_ID])
        return { id: COVER_ID }
      },
    }
    await assertEventCover(tx, {
      appId: APP_ID,
      actorUserId: USER_ID,
      draft: { coverAssetId: COVER_ID },
    }, null)
  })

  it('allows only the already-bound cover fact to be retained across operators', async () => {
    const tx = {
      async one(sql, params) {
        assert.doesNotMatch(sql, /owner_user_id = \?/)
        assert.match(sql, /purpose = 'EVENT_COVER'/)
        assert.deepEqual(params, [APP_ID, COVER_ID])
        return { id: COVER_ID }
      },
    }
    await assertEventCover(tx, {
      appId: APP_ID,
      actorUserId: USER_ID,
      draft: { coverAssetId: COVER_ID },
    }, COVER_ID)
  })
})
