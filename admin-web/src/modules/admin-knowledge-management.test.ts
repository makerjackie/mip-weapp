import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadKnowledge } from './admin-knowledge-management.ts'
import type { AdminRequest } from './admin-read-contracts.ts'
import { contentFormValues } from './content-form-values.ts'
import { getContentMutationForm, validateContentMutation } from './content-mutation-forms.ts'

const require = createRequire(import.meta.url)
const { createKnowledgeAdminService } = require('../../../cloudfunctions/mip-admin-api/domain/knowledge.js')
const firstId = '10000000-0000-4000-8000-000000000001'
const secondId = '20000000-0000-4000-8000-000000000002'

it('passes nonempty serialized service pages to the knowledge table and binds the cursor to tenant and filters', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const service = createKnowledgeAdminService({
    one: async () => ({ id: 'user', status: 'ACTIVE', primary_branch_id: 'branch-a', nickname: '运营', phone_verified_at: new Date(), agreement_0_accepted: 1, agreement_1_accepted: 1 }),
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      if (sql.includes('mip_admin_role_bindings')) return [{ role_key: 'PLATFORM_OPERATIONS', scope_type: 'PLATFORM', scope_id: null }]
      const rows = [firstId, secondId].map((id, index) => ({ id, title: `完整运营知识 ${index}`, summary: '非空正文摘要', content_type: 'ARTICLE', access_type: 'MEMBER', status: 'DRAFT', category_name: '运营', author_name: '运营者', version: 1, updated_at: new Date(`2030-01-0${2 - index}T00:00:00Z`) }))
      return params.length > 7 ? rows.slice(1) : rows
    },
  })
  const request: AdminRequest = async <T>(_action: string, input = {}) => JSON.parse(JSON.stringify(await service.listKnowledgeAdmin({ appId: 'app', identityKey: 'identity' }, input))) as T
  const query = { query: firstId, status: 'DRAFT', cursor: null, limit: 1 }
  const first = await loadKnowledge(query, request)
  assert.equal(first.sections[0].rows[0].title, '完整运营知识 0')
  assert.ok(first.nextCursor)
  const second = await loadKnowledge({ ...query, cursor: first.nextCursor }, request)
  assert.equal(second.sections[0].rows[0].detailId, secondId)
  assert.equal(second.nextCursor, null)
  assert.ok(calls.some(call => call.sql.includes('content.updated_at < ?') && call.params[1] === 'app'))
  await assert.rejects(loadKnowledge({ ...query, query: '其他筛选', cursor: first.nextCursor }, request), /VALIDATION_FAILED/)
})

it('keeps full source configuration and converts product price through the reviewed submit interface', () => {
  const source = { sourceId: firstId, expectedVersion: 2, sourceKey: 'source-rss', name: '运营日报', sourceType: 'RSS', endpointUrl: 'https://example.com/rss', status: 'ACTIVE', fetchConfig: { itemsPath: 'data.items' } }
  const mapped = contentFormValues('mip.admin.knowledge.sources.save', source, 'key')
  const validated = validateContentMutation('mip.admin.knowledge.sources.save', mapped)
  assert.equal(validated.ok, true)
  if (validated.ok) assert.deepEqual(validated.input, source)
  assert.equal(getContentMutationForm('mip.admin.knowledge.schedules.save').fields.find(field => field.key === 'sourceId')?.optionsAction, 'mip.admin.knowledge.list')
  const product = validateContentMutation('mip.admin.knowledge.products.save', { contentId: firstId, name: '知识解锁', priceCents: 1990, unlockDays: 30, refundPolicy: 'BEFORE_ACCESS', refundWindowHours: 0, status: 'DRAFT' })
  assert.equal(product.ok, true)
  if (product.ok) { assert.equal(product.input.priceCents, 1990); assert.equal(product.input.refundWindowHours, 0) }
})
