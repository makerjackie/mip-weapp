import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadIndustryCatalog, createIndustryMutationDefinition, type IndustryCatalogItem } from './admin-industry-management.ts'
import type { AdminRequest } from './admin-read-contracts.ts'

const group: IndustryCatalogItem = { id: 'group-1', label: '互联网/AI', parentId: null, selectable: false, popular: false, enabled: true, sortOrder: 1, version: 2 }
const child: IndustryCatalogItem = { id: 'industry-1', label: '人工智能', parentId: group.id, selectable: true, popular: true, enabled: false, sortOrder: 2, version: 3 }
const request: AdminRequest = async <T>() => ({ items: [group, child] }) as T

describe('industry management module', () => {
  it('accepts nonempty server fields and rejects malformed reads instead of showing an empty list', async () => {
    assert.deepEqual(await loadIndustryCatalog(request), [group, child])
    for (const response of [{ rows: [] }, { items: [{ ...child, enabled: '0' }] }, { items: [{ ...child, version: undefined }] }]) {
      await assert.rejects(() => loadIndustryCatalog(async <T>() => response as T), /无效目录/)
    }
  })
  it('builds new groups without an ID or editable technical fields', async () => {
    const form = await createIndustryMutationDefinition('mip.admin.industries.save', '', { values: { parentId: null } }, request)
    assert.deepEqual(form.buildInput({ label: '新行业分类', sortOrder: 0 }), { label: '新行业分类', parentId: null, popular: false, sortOrder: 0 })
    assert.deepEqual(form.fields.map(field => field.key), ['label', 'sortOrder'])
  })
  it('preserves IDs and the server version while editing child labels, popularity and order', async () => {
    const form = await createIndustryMutationDefinition('mip.admin.industries.save', child.id, {}, request)
    assert.deepEqual(form.buildInput({ ...form.values, label: 'AI应用', popular: false, sortOrder: 8 }), { tagId: child.id, expectedVersion: 3, label: 'AI应用', parentId: group.id, popular: false, sortOrder: 8 })
    assert.equal(form.buildInput({ ...form.values, parentId: 'missing' }), null)
    assert.equal(form.buildInput({ ...form.values, sortOrder: 0.5 }), null)
  })
  it('keeps enable/disable a confirmed versioned operation', async () => {
    const form = await createIndustryMutationDefinition('mip.admin.industries.changeStatus', child.id, { expectedVersion: 3, values: { enabled: true } }, request)
    assert.equal(form.title, '启用“人工智能”')
    assert.deepEqual(form.buildInput({}), { tagId: child.id, expectedVersion: 3, enabled: true })
  })
})
