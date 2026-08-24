'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { assertReferences: assertCaseReferences } = require('../domain/cases')
const { assertReferences: assertOpportunityReferences } = require('../domain/opportunities')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const COVER_ID = '22222222-2222-4222-8222-222222222222'
const MEDIA_ID = '33333333-3333-4333-8333-333333333333'
const caller = { appId: APP_ID, userId: USER_ID }

describe('opportunity and super-case media ownership', () => {
  it('requires an owned READY OPPORTUNITY_COVER for opportunity saves', async () => {
    const tx = {
      async one(sql, params) {
        assert.match(sql, /owner_user_id = \?/)
        assert.match(sql, /purpose = 'OPPORTUNITY_COVER'/)
        assert.match(sql, /status = 'READY'/)
        assert.deepEqual(params, [APP_ID, COVER_ID, USER_ID])
        return { found: 1 }
      },
      async query() { return [] },
    }
    await assertOpportunityReferences(tx, caller, {
      branchId: null,
      coverAssetId: COVER_ID,
      cityTagId: null,
      industryTagIds: [],
      abilityTagIds: [],
    })
  })

  it('rejects a case cover or gallery asset with a forged purpose', async () => {
    const tx = {
      async query(sql, params) {
        assert.match(sql, /owner_user_id = \?/)
        assert.match(sql, /status = 'READY'/)
        assert.deepEqual(params, [APP_ID, USER_ID, COVER_ID, MEDIA_ID])
        return [
          { id: COVER_ID, purpose: 'SUPER_CASE_MEDIA' },
          { id: MEDIA_ID, purpose: 'SUPER_CASE_MEDIA' },
        ]
      },
    }
    await assert.rejects(() => assertCaseReferences(tx, caller, {
      cityTagId: null,
      industryTagId: null,
      coverAssetId: COVER_ID,
      mediaAssetIds: [MEDIA_ID],
    }), /VALIDATION_FAILED/)
  })
})
