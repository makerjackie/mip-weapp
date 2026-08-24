'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createKnowledgeService } = require('../domain/knowledge')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'

function contentRow(overrides = {}) {
  return {
    id: contentId,
    content_type: 'ARTICLE',
    title: '行业观察',
    summary: '摘要',
    body_text: '服务端正文',
    author_name: '专家',
    access_type: 'MEMBER_OR_PAID',
    category_id: '30000000-0000-4000-8000-000000000001',
    category_name: '商业',
    source_name: 'MIP',
    cover_file_id: null,
    product_id: '40000000-0000-4000-8000-000000000001',
    product_name: '单内容解锁',
    price_cents: 990,
    currency: 'CNY',
    catalog_stage: 'TEST',
    refund_policy: 'BEFORE_ACCESS',
    refund_window_hours: 24,
    unlock_days: null,
    has_membership: 0,
    content_entitlement_id: null,
    entitlement_first_accessed_at: null,
    entitlement_ends_at: null,
    published_at: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  }
}

describe('knowledge community service', () => {
  it('groups the public category projection under ONLY_FULL_GROUP_BY', async () => {
    const calls = []
    const service = createKnowledgeService({
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    })
    assert.deepEqual(await service.listKnowledgeCategories({ appId }), { items: [] })
    assert.match(calls[0].sql, /GROUP BY category\.id, category\.category_key, category\.name, category\.summary, category\.sort_order/)
    assert.deepEqual(calls[0].params, [appId])
  })

  it('hides protected fields until a server entitlement unlocks the content', async () => {
    const updates = []
    const database = {
      async transaction(work) {
        return work({
          async one(sql) {
            return sql.includes('FROM mip_users')
              ? { id: userId, status: 'ACTIVE' }
              : contentRow()
          },
          async query(sql, params) { updates.push({ sql, params }) },
        })
      },
    }
    const service = createKnowledgeService(database, { catalogStage: 'TEST' })
    const result = await service.getKnowledgeContent({ appId, userId }, { contentId })
    assert.equal(result.access.unlocked, false)
    assert.equal(result.access.reason, 'PURCHASE_REQUIRED')
    assert.equal(result.body, '')
    assert.equal(result.externalUrl, '')
    assert.equal(updates.length, 0)
  })

  it('records first access atomically for a purchased entitlement', async () => {
    const updates = []
    const entitlementId = '50000000-0000-4000-8000-000000000001'
    const database = {
      async transaction(work) {
        return work({
          async one(sql) {
            return sql.includes('FROM mip_users')
              ? { id: userId, status: 'ACTIVE' }
              : contentRow({ content_entitlement_id: entitlementId })
          },
          async query(sql, params) { updates.push({ sql, params }) },
        })
      },
    }
    const service = createKnowledgeService(database, { catalogStage: 'TEST' })
    const result = await service.getKnowledgeContent({ appId, userId }, { contentId })
    assert.equal(result.access.reason, 'PURCHASED')
    assert.equal(result.body, '服务端正文')
    assert.match(updates[0].sql, /first_accessed_at = UTC_TIMESTAMP/)
    assert.deepEqual(updates[0].params, [appId, entitlementId])
  })

  it('falls back to anonymous access when account closure wins the user lock', async () => {
    const entitlementId = '50000000-0000-4000-8000-000000000001'
    const calls = []
    const database = {
      async transaction(work) {
        return work({
          async one(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('mip_user_identities')) return { user_id: userId }
            if (sql.includes('FROM mip_users')) return { id: userId, status: 'CLOSED' }
            return contentRow({ content_entitlement_id: params[2] ? entitlementId : null })
          },
          async query() { assert.fail('closed user mutated first-access fact') },
        })
      },
    }
    const service = createKnowledgeService(database, { catalogStage: 'TEST' })
    const result = await service.getKnowledgeContent({ appId, identityKey: 'identity' }, { contentId })
    assert.equal(result.access.unlocked, false)
    assert.equal(result.body, '')
    assert.match(calls[0].sql, /mip_user_identities[\s\S]*FOR UPDATE/)
    assert.match(calls[1].sql, /mip_users[\s\S]*FOR UPDATE/)
    assert.equal(calls[2].params[2], '')
  })

  it('scopes public search and the active product catalog to the trusted AppID', async () => {
    const calls = []
    const service = createKnowledgeService({
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }, { catalogStage: 'TEST' })
    const result = await service.listKnowledgeContents({ appId }, { query: '商业', limit: 10 })
    assert.deepEqual(result.items, [])
    assert.match(calls[0].sql, /content\.app_id = \?/)
    assert.match(calls[0].sql, /product\.catalog_stage = \?/)
    assert.equal(calls[0].params[0], 'TEST')
    assert.equal(calls[0].params[1], appId)
    assert.equal(calls[0].params.includes('%商业%'), true)
  })
})
