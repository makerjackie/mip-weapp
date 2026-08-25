'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  assertInteractionReady,
  configuredAgreementRequirements,
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
  const currentAgreements = [
    { key: 'SERVICE_AGREEMENT', version: 'service-v2' },
    { key: 'PRIVACY_POLICY', version: 'privacy-v3' },
  ]
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ sql, params })
      return {
        user_status: 'ACTIVE',
        primary_branch_id: 'branch-1',
        nickname: '测试用户',
        phone_verified_at: '2026-08-25T00:00:00.000Z',
      }
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return currentAgreements.map(agreement => ({
        agreement_key: agreement.key,
        agreement_version: agreement.version,
      }))
    },
  }
  await assert.doesNotReject(assertInteractionReady(database, {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  }, currentAgreements))
  assert.match(calls[0].sql, /mip_users[\s\S]*FOR UPDATE/)
  assert.deepEqual(calls[0].params, ['wx-community-test', 'user-1'])
  assert.match(calls[1].sql, /agreement_key, agreement_version/)
  assert.match(calls[1].sql, /FOR UPDATE/)

  await assert.rejects(assertInteractionReady({
    async one() {
      return {
        user_status: 'ACTIVE',
        primary_branch_id: 'branch-1',
        nickname: '测试用户',
        phone_verified_at: null,
      }
    },
    async query() {
      return currentAgreements.map(agreement => ({
        agreement_key: agreement.key,
        agreement_version: agreement.version,
      }))
    },
  }, {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  }, currentAgreements), /PHONE_REQUIRED/)

  await assert.rejects(assertInteractionReady({
    async one() {
      return {
        user_status: 'ACTIVE',
        primary_branch_id: 'branch-1',
        nickname: '测试用户',
        phone_verified_at: '2026-08-25T00:00:00.000Z',
      }
    },
    async query() {
      return [{ agreement_key: 'SERVICE_AGREEMENT', agreement_version: 'service-v1' }]
    },
  }, {
    appId: 'wx-community-test',
    userId: 'user-1',
    primaryBranchId: 'branch-1',
  }, currentAgreements), /AGREEMENT_REQUIRED/)
})

test('agreement requirements use the shared current catalog contract', () => {
  assert.deepEqual(configuredAgreementRequirements(JSON.stringify([
    { key: 'SERVICE_AGREEMENT', version: 'service-v4', label: '用户协议' },
  ])), [{ key: 'SERVICE_AGREEMENT', version: 'service-v4' }])
  assert.throws(() => configuredAgreementRequirements('[]'), /AGREEMENT_CONFIG_INVALID/)
  assert.throws(() => configuredAgreementRequirements('{invalid'), /AGREEMENT_CONFIG_INVALID/)
})
