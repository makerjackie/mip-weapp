'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  assertInteractionReady,
  resolveActiveUser,
  trustedWechatIdentity,
} = require('../lib/identity')

const allowedAppIds = new Set(['wx-community-test'])
const pepper = 'community-identity-test-pepper-value-over-32'

test('trusted identity uses only CloudBase context and returns a hashed subject', () => {
  const identity = trustedWechatIdentity({
    FROM_APPID: 'wx-community-test',
    FROM_OPENID: 'openid-from-context',
    APPID: 'wx-ignored',
    OPENID: 'ignored',
  }, { allowedAppIds, pepper })
  assert.equal(identity.appId, 'wx-community-test')
  assert.match(identity.identityKey, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(identity).includes('openid-from-context'), false)
})

test('caller resolution is app-scoped and fails closed for unavailable users', async () => {
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ sql, params })
      return { id: 'user-1', status: 'ACTIVE', primary_branch_id: 'branch-1' }
    },
  }
  assert.deepEqual(await resolveActiveUser(database, { appId: 'wx-community-test', identityKey: 'key' }), {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  })
  assert.match(calls[0].sql, /i\.app_id = \?/)
  assert.deepEqual(calls[0].params, ['wx-community-test', 'key'])
})

test('interaction readiness is rebuilt from server facts', async () => {
  const database = { async one() { return { has_profile: 1, has_phone: 1, has_agreement: 1 } } }
  await assert.doesNotReject(assertInteractionReady(database, {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  }))
  await assert.rejects(assertInteractionReady({ async one() { return { has_profile: 1, has_phone: 0, has_agreement: 1 } } }, {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  }), /PHONE_REQUIRED/)
})
