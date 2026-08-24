'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createKnowledgeAdminService, normalizeIngestionItem, safeExternalUrl } = require('../domain/knowledge')

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
        return { id: 'user', status: 'ACTIVE', has_profile: 1, has_phone: 1, has_agreement: 1 }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('mip_admin_role_bindings')) {
          return [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }]
        }
        return []
      },
    }
    const service = createKnowledgeAdminService(database)
    const result = await service.listKnowledgeAdmin({ appId: 'app', identityKey: 'identity' }, { section: 'SOURCES' })
    assert.deepEqual(result.items, [])
    assert.match(calls[2].sql, /mip_knowledge_sources/)
    assert.deepEqual(calls[2].params, ['app', 50])
  })

  it('rechecks the active knowledge grant inside the mutation transaction', async () => {
    const user = { id: 'user', status: 'ACTIVE', has_profile: 1, has_phone: 1, has_agreement: 1 }
    const database = {
      async one() { return user },
      async query(sql) {
        return sql.includes('mip_admin_role_bindings')
          ? [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }]
          : []
      },
      async transaction(work) {
        return work({
          async one() { return user },
          async query(sql) {
            if (sql.includes('mip_admin_role_bindings')) return []
            assert.fail(`mutation reached after revocation: ${sql}`)
          },
        })
      },
    }
    const service = createKnowledgeAdminService(database)
    await assert.rejects(() => service.moderateKnowledgeComment(
      { appId: 'app', identityKey: 'identity' },
      {
        commentId: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        decision: 'HIDE',
        reason: '违规',
      },
    ), /FORBIDDEN/)
  })

  it('rechecks account status inside the mutation transaction', async () => {
    const active = { id: 'user', status: 'ACTIVE', has_profile: 1, has_phone: 1, has_agreement: 1 }
    const database = {
      async one() { return active },
      async query(sql) {
        return sql.includes('mip_admin_role_bindings')
          ? [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }]
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
      { appId: 'app', identityKey: 'identity' },
      {
        commentId: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        decision: 'HIDE',
        reason: '违规',
      },
    ), /FORBIDDEN/)
  })

  it('refuses to moderate comments and reports outside the KNOWLEDGE target', async () => {
    const user = { id: 'user', status: 'ACTIVE', has_profile: 1, has_phone: 1, has_agreement: 1 }
    const inspected = []
    const grant = [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }]
    const database = {
      async one() { return user },
      async query(sql) { return sql.includes('mip_admin_role_bindings') ? grant : [] },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('mip_user_identities')) return user
            inspected.push(sql)
            return null
          },
          async query(sql) { return sql.includes('mip_admin_role_bindings') ? grant : [] },
        })
      },
    }
    const service = createKnowledgeAdminService(database)
    await assert.rejects(() => service.moderateKnowledgeComment(
      { appId: 'app', identityKey: 'identity' },
      {
        commentId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1,
        decision: 'HIDE', reason: '违规',
      },
    ), /NOT_FOUND/)
    await assert.rejects(() => service.closeKnowledgeCommentReport(
      { appId: 'app', identityKey: 'identity' },
      {
        reportId: '20000000-0000-4000-8000-000000000001', expectedVersion: 1,
        status: 'DISMISSED', reason: '不成立',
      },
    ), /NOT_FOUND/)
    assert.match(inspected[0], /target_type = 'KNOWLEDGE'/)
    assert.match(inspected[1], /comment\.target_type = 'KNOWLEDGE'/)
  })
})
