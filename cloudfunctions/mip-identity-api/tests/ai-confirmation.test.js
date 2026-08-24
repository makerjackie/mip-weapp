'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { confirmProfileAiDraft, normalizeAiConfirmation } = require('../domain/ai-confirmation')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'

function input(overrides = {}) {
  return {
    appId: APP_ID,
    userId: USER_ID,
    confirmation: { draftId: DRAFT_ID, expectedVersion: 3 },
    profile: {
      nickname: 'MIP 用户',
      identityStatus: '创业者',
      headline: '产品负责人',
      introduction: '个人介绍',
      companies: [{ name: '示例公司' }],
      organizations: [],
    },
    ...overrides,
  }
}

describe('profile AI draft confirmation', () => {
  it('binds owner, purpose and version while updating the edited official snapshot', async () => {
    let updateSeen = false
    const tx = {
      async one(sql, params) {
        assert.match(sql, /WHERE app_id = \? AND user_id = \? AND id = \?/)
        assert.match(sql, /FOR UPDATE/)
        assert.deepEqual(params, [APP_ID, USER_ID, DRAFT_ID])
        return {
          id: DRAFT_ID,
          purpose: 'PROFILE',
          status: 'DRAFT_READY',
          version: 3,
          expires_at: '2099-01-01T00:00:00.000Z',
        }
      },
      async query(sql, params) {
        updateSeen = true
        assert.match(sql, /status = 'CONFIRMED'/)
        assert.equal(JSON.parse(params[0]).headline, '产品负责人')
        assert.deepEqual(params.slice(1), [USER_ID, APP_ID, USER_ID, DRAFT_ID, 3])
        return { affectedRows: 1 }
      },
    }
    assert.deepEqual(await confirmProfileAiDraft(tx, input()), { confirmed: true, idempotent: false })
    assert.equal(updateSeen, true)
  })

  it('rejects expired, wrong-purpose or malformed confirmation data', async () => {
    assert.throws(() => normalizeAiConfirmation({ draftId: 'forged', expectedVersion: 1 }), /AI_DRAFT_INVALID/)
    await assert.rejects(() => confirmProfileAiDraft({
      async one() {
        return { purpose: 'SUPER_CASE', status: 'DRAFT_READY', version: 3, expires_at: '2000-01-01' }
      },
    }, input()), /AI_DRAFT_CONFLICT/)
  })
})
