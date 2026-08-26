'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createKnowledgeAdminService, normalizeIngestionItem, safeExternalUrl } = require('../domain/knowledge')

const caller = { appId: 'app', identityKey: 'identity' }
const platformKnowledgeGrant = [
  { role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null },
]

function accessRow(overrides = {}) {
  return {
    id: 'user',
    status: 'ACTIVE',
    primary_branch_id: 'branch-a',
    nickname: '运营人员',
    phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
    agreement_0_accepted: 1,
    agreement_1_accepted: 1,
    ...overrides,
  }
}

describe('knowledge admin service', () => {
  it('rejects local or credential-bearing ingestion endpoints', () => {
    const policy = { allowedHosts: new Set(['example.com']) }
    assert.throws(() => safeExternalUrl('http://example.com/feed', policy), /VALIDATION_FAILED/)
    assert.throws(() => safeExternalUrl('https://127.0.0.1/feed', policy), /VALIDATION_FAILED/)
    assert.throws(() => safeExternalUrl('https://user:secret@example.com/feed', policy), /VALIDATION_FAILED/)
    assert.throws(() => safeExternalUrl('https://other.example/feed', policy), /VALIDATION_FAILED/)
    assert.equal(safeExternalUrl('https://example.com/feed', policy), 'https://example.com/feed')
  })

  it('normalizes source items into stable dedupe hashes without publishing them', () => {
    const first = normalizeIngestionItem({ title: '热点', summary: '摘要', externalUrl: 'https://example.com/a' })
    const replay = normalizeIngestionItem({ title: '热点', summary: '不同摘要', externalUrl: 'https://example.com/a' })
    assert.equal(first.contentHash, replay.contentHash)
    assert.match(first.contentHash, /^[a-f0-9]{64}$/)
    assert.equal(first.contentType, 'HOT_NEWS')
  })

  it('requires platform knowledge capability before reading source configuration', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return accessRow()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('mip_admin_role_bindings')) {
          return platformKnowledgeGrant
        }
        return []
      },
    }
    const service = createKnowledgeAdminService(database)
    const result = await service.listKnowledgeAdmin(caller, { section: 'SOURCES' })
    assert.deepEqual(result.items, [])
    assert.match(calls[2].sql, /mip_knowledge_sources/)
    assert.deepEqual(calls[2].params, ['app', 50])
  })

  it('groups aggregate lists by the complete app-scoped primary key', async () => {
    const calls = []
    const database = {
      async one() { return accessRow() },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('mip_admin_role_bindings')) return platformKnowledgeGrant
        return []
      },
    }
    const service = createKnowledgeAdminService(database)

    await service.listKnowledgeAdmin(caller, { section: 'CATEGORIES' })
    await service.listKnowledgeAdmin(caller, { section: 'COMMENTS' })

    const categoryQuery = calls.find(call => call.sql.includes('FROM mip_knowledge_categories category'))
    const commentQuery = calls.find(call => call.sql.includes('FROM mip_content_comments comment'))
    assert.match(categoryQuery.sql, /GROUP BY category\.app_id, category\.id/)
    assert.match(commentQuery.sql, /GROUP BY comment\.app_id, comment\.id/)
    assert.deepEqual(categoryQuery.params, ['app', 50])
    assert.deepEqual(commentQuery.params, ['app', null, null, 50])
  })

  it('checks every current agreement and the primary branch before platform capability', async () => {
    const cases = [
      {
        name: 'one current agreement is missing',
        row: accessRow({ agreement_1_accepted: 0 }),
        error: /AGREEMENT_REQUIRED/,
      },
      {
        name: 'only an old agreement was accepted',
        row: accessRow({ agreement_0_accepted: 0, has_agreement: 1 }),
        error: /AGREEMENT_REQUIRED/,
      },
      {
        name: 'primary branch is missing',
        row: accessRow({ primary_branch_id: null, has_profile: 1 }),
        error: /PROFILE_REQUIRED/,
      },
    ]

    for (const testCase of cases) {
      let roleReads = 0
      const service = createKnowledgeAdminService({
        async one() { return testCase.row },
        async query() {
          roleReads += 1
          return platformKnowledgeGrant
        },
      })
      await assert.rejects(
        () => service.listKnowledgeAdmin(caller, { section: 'SOURCES' }),
        testCase.error,
        testCase.name,
      )
      assert.equal(roleReads, 0, testCase.name)
    }
  })

  it('reuses the injected full-access policy for the locked mutation recheck', async () => {
    const unlockedUser = {
      id: 'user',
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    }
    const policyCalls = []
    const fullAccessPolicy = {
      async loadByIdentity(queryable, actualCaller, options = {}) {
        policyCalls.push({ queryable, caller: actualCaller, lock: options.lock === true })
        return options.lock === true
          ? { ...unlockedUser, agreementsAccepted: false }
          : unlockedUser
      },
    }
    const transactionEffects = []
    let tx
    const database = {
      async query(sql) {
        return sql.includes('mip_admin_role_bindings') ? platformKnowledgeGrant : []
      },
      async transaction(work) {
        tx = {
          async query(sql) {
            transactionEffects.push(sql)
            return sql.includes('mip_admin_role_bindings') ? platformKnowledgeGrant : []
          },
        }
        return work(tx)
      },
    }
    const service = createKnowledgeAdminService(database, { fullAccessPolicy })

    await assert.rejects(() => service.moderateKnowledgeComment(caller, {
      commentId: '10000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      decision: 'HIDE',
      reason: '违规',
    }), /AGREEMENT_REQUIRED/)

    assert.equal(policyCalls.length, 2)
    assert.equal(policyCalls[0].queryable, database)
    assert.equal(policyCalls[0].caller, caller)
    assert.equal(policyCalls[0].lock, false)
    assert.equal(policyCalls[1].queryable, tx)
    assert.equal(policyCalls[1].caller, caller)
    assert.equal(policyCalls[1].lock, true)
    assert.deepEqual(transactionEffects, [])
  })

  it('does not write facts or audit after the knowledge grant is revoked in the transaction', async () => {
    const user = accessRow()
    const transactionEffects = []
    const database = {
      async one() { return user },
      async query(sql) {
        return sql.includes('mip_admin_role_bindings')
          ? platformKnowledgeGrant
          : []
      },
      async transaction(work) {
        return work({
          async one() { return user },
          async query(sql) {
            if (sql.includes('mip_admin_role_bindings')) return []
            transactionEffects.push(sql)
            return []
          },
        })
      },
    }
    const service = createKnowledgeAdminService(database)
    await assert.rejects(() => service.moderateKnowledgeComment(
      caller,
      {
        commentId: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        decision: 'HIDE',
        reason: '违规',
      },
    ), /FORBIDDEN/)
    assert.deepEqual(transactionEffects, [])
  })

  it('rechecks account status inside the mutation transaction', async () => {
    const active = accessRow()
    const database = {
      async one() { return active },
      async query(sql) {
        return sql.includes('mip_admin_role_bindings')
          ? platformKnowledgeGrant
          : []
      },
      async transaction(work) {
        return work({
          async one() { return { ...active, status: 'CLOSED' } },
          async query() { assert.fail('closed admin reached mutation') },
        })
      },
    }
    const service = createKnowledgeAdminService(database)
    await assert.rejects(() => service.moderateKnowledgeComment(
      caller,
      {
        commentId: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        decision: 'HIDE',
        reason: '违规',
      },
    ), /FORBIDDEN/)
  })

  it('refuses to moderate comments and reports outside the KNOWLEDGE target', async () => {
    const user = accessRow()
    const inspected = []
    const database = {
      async one() { return user },
      async query(sql) { return sql.includes('mip_admin_role_bindings') ? platformKnowledgeGrant : [] },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('mip_user_identities')) return user
            inspected.push(sql)
            return null
          },
          async query(sql) { return sql.includes('mip_admin_role_bindings') ? platformKnowledgeGrant : [] },
        })
      },
    }
    const service = createKnowledgeAdminService(database)
    await assert.rejects(() => service.moderateKnowledgeComment(
      caller,
      {
        commentId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1,
        decision: 'HIDE', reason: '违规',
      },
    ), /NOT_FOUND/)
    await assert.rejects(() => service.closeKnowledgeCommentReport(
      caller,
      {
        reportId: '20000000-0000-4000-8000-000000000001', expectedVersion: 1,
        status: 'DISMISSED', reason: '不成立',
      },
    ), /NOT_FOUND/)
    assert.match(inspected[0], /target_type = 'KNOWLEDGE'/)
    assert.match(inspected[1], /comment\.target_type = 'KNOWLEDGE'/)
  })
})
