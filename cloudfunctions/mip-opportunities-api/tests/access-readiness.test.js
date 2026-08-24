'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  assertFullAccessReady,
  configuredAgreementRequirements,
  lockActiveContributor,
  requiresFullAccessAction,
} = require('../lib/auth')

const appId = 'wx-opportunity-access'
const userId = '10000000-0000-4000-8000-000000000001'
const branchId = '20000000-0000-4000-8000-000000000001'
const caller = { appId, userId }
const currentAgreements = [
  { key: 'SERVICE_AGREEMENT', version: 'v3' },
  { key: 'PRIVACY_POLICY', version: 'v5' },
]

function readinessDatabase(overrides = {}) {
  const calls = []
  const database = {
    calls,
    async one(sql, params) {
      calls.push({ method: 'one', sql, params })
      return overrides.facts === undefined
        ? {
            user_status: 'ACTIVE',
            primary_branch_id: branchId,
            nickname: 'MIP 用户',
            phone_verified_at: '2026-08-24T00:00:00.000Z',
          }
        : overrides.facts
    },
    async query(sql, params) {
      calls.push({ method: 'query', sql, params })
      return overrides.acceptances === undefined
        ? currentAgreements.map(requirement => ({
            agreement_key: requirement.key,
            agreement_version: requirement.version,
          }))
        : overrides.acceptances
    },
  }
  return database
}

test('agreement requirements use the identity API defaults and exact configured versions', () => {
  assert.deepEqual(configuredAgreementRequirements(undefined), [
    { key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' },
    { key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' },
  ])
  assert.deepEqual(configuredAgreementRequirements(JSON.stringify([
    {
      key: 'SERVICE_AGREEMENT',
      label: '用户协议',
      version: 'v3',
      documentPath: '/packages/member/user-agreement/index',
    },
  ])), [{ key: 'SERVICE_AGREEMENT', version: 'v3' }])
  assert.throws(() => configuredAgreementRequirements('[]'), /AGREEMENT_CONFIG_INVALID/)
  assert.throws(() => configuredAgreementRequirements('{invalid'), /AGREEMENT_CONFIG_INVALID/)
})

test('full readiness is rebuilt from exact app-scoped ACTIVE user facts', async () => {
  const database = readinessDatabase()
  await assert.doesNotReject(assertFullAccessReady(database, caller, currentAgreements))

  assert.match(database.calls[0].sql, /FROM mip_users u/)
  assert.match(database.calls[0].sql, /u\.app_id = \? AND u\.id = \?/)
  assert.deepEqual(database.calls[0].params, [appId, userId])
  assert.match(database.calls[1].sql, /FROM mip_agreement_acceptances/)
  assert.match(database.calls[1].sql, /app_id = \? AND user_id = \?/)
  assert.deepEqual(database.calls[1].params, [appId, userId])
})

test('historical agreement acceptance does not satisfy the current version', async () => {
  const database = readinessDatabase({
    acceptances: [
      { agreement_key: 'SERVICE_AGREEMENT', agreement_version: 'v2' },
      { agreement_key: 'PRIVACY_POLICY', agreement_version: 'v5' },
    ],
  })
  await assert.rejects(
    assertFullAccessReady(database, caller, currentAgreements),
    /AGREEMENT_REQUIRED/,
  )
})

test('full readiness fails closed for inactive, phone-less, or incomplete users', async () => {
  await assert.rejects(
    assertFullAccessReady(readinessDatabase({
      facts: {
        user_status: 'CLOSED',
        primary_branch_id: branchId,
        nickname: 'MIP 用户',
        phone_verified_at: '2026-08-24T00:00:00.000Z',
      },
    }), caller, currentAgreements),
    /FORBIDDEN/,
  )
  await assert.rejects(
    assertFullAccessReady(readinessDatabase({
      facts: {
        user_status: 'ACTIVE',
        primary_branch_id: branchId,
        nickname: 'MIP 用户',
        phone_verified_at: null,
      },
    }), caller, currentAgreements),
    /PHONE_REQUIRED/,
  )
  for (const facts of [
    {
      user_status: 'ACTIVE',
      primary_branch_id: branchId,
      nickname: '   ',
      phone_verified_at: '2026-08-24T00:00:00.000Z',
    },
    {
      user_status: 'ACTIVE',
      primary_branch_id: null,
      nickname: 'MIP 用户',
      phone_verified_at: '2026-08-24T00:00:00.000Z',
    },
  ]) {
    await assert.rejects(
      assertFullAccessReady(readinessDatabase({ facts }), caller, currentAgreements),
      /PROFILE_REQUIRED/,
    )
  }
})

test('only protected contribution writes require full readiness', () => {
  for (const action of [
    'saveOpportunity',
    'endOpportunity',
    'setReferral',
    'setProfileInterest',
    'saveCooperationCard',
    'unpublishCooperationCard',
    'archiveCooperationCard',
    'saveSuperCase',
    'unpublishSuperCase',
    'archiveSuperCase',
  ]) {
    assert.equal(requiresFullAccessAction(action), true, action)
  }
  for (const action of [
    'listMine',
    'listMyCooperationCards',
    'listMySuperCases',
    'listReceivedInteractions',
    'markReceivedInteractionRead',
    'getOpportunity',
  ]) {
    assert.equal(requiresFullAccessAction(action), false, action)
  }
})

test('protected mutations lock the current ACTIVE user inside the transaction', async () => {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      return { id: userId, status: 'ACTIVE' }
    },
  }
  await assert.doesNotReject(lockActiveContributor(tx, caller))
  assert.match(calls[0].sql, /FROM mip_users/)
  assert.match(calls[0].sql, /FOR UPDATE/)
  assert.deepEqual(calls[0].params, [appId, userId])

  await assert.rejects(
    lockActiveContributor({ async one() { return { id: userId, status: 'CLOSED' } } }, caller),
    /FORBIDDEN/,
  )
})
