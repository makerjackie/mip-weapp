'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { confirmAiDraft, normalizeAiConfirmation } = require('../domain/ai-confirmation')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'

describe('content AI draft confirmation', () => {
  it('confirms a draft for exactly one official resource inside the caller transaction', async () => {
    const confirmation = normalizeAiConfirmation({ draftId: DRAFT_ID, expectedVersion: 5 }, 'SUPER_CASE')
    const tx = {
      async one(sql, params) {
        assert.match(sql, /FOR UPDATE/)
        assert.deepEqual(params, [APP_ID, USER_ID, DRAFT_ID])
        return {
          purpose: 'SUPER_CASE',
          status: 'DRAFT_READY',
          version: 5,
          expires_at: '2099-01-01T00:00:00.000Z',
        }
      },
      async query(sql, params) {
        assert.match(sql, /confirmed_resource_type = \?/)
        assert.equal(JSON.parse(params[0]).projectName, '示例项目')
        assert.deepEqual(params.slice(1), ['SUPER_CASE', RESOURCE_ID, APP_ID, USER_ID, DRAFT_ID, 5])
        return { affectedRows: 1 }
      },
    }
    await assert.doesNotReject(() => confirmAiDraft(tx, {
      appId: APP_ID,
      userId: USER_ID,
      confirmation,
      resourceId: RESOURCE_ID,
      structuredDraft: { projectName: '示例项目' },
    }))
  })

  it('does not let an already confirmed draft move to another resource', async () => {
    await assert.rejects(() => confirmAiDraft({
      async one() {
        return {
          status: 'CONFIRMED',
          confirmed_resource_type: 'SUPER_CASE',
          confirmed_resource_id: '44444444-4444-4444-8444-444444444444',
        }
      },
    }, {
      appId: APP_ID,
      userId: USER_ID,
      confirmation: { draftId: DRAFT_ID, expectedVersion: 5, purpose: 'SUPER_CASE' },
      resourceId: RESOURCE_ID,
      structuredDraft: {},
    }), /AI_DRAFT_CONFLICT/)
  })
})
