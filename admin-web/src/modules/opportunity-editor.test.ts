import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { opportunityEditorValues } from './opportunity-editor.ts'
import { contentFormValues } from './content-form-values.ts'
import { validateContentMutation } from './content-mutation-forms.ts'
import { rebaseEdit } from './edit-conflict.ts'
import { loadOpportunities } from './admin-read-special-pages.ts'

const require = createRequire(import.meta.url)
const { createAdminPrdExtensions } = require('../../../cloudfunctions/mip-admin-api/domain/admin-prd-extensions.js')
const cityId = '00000000-0000-4000-8000-000000000001'

export async function serializedOpportunity() {
  const repository = createAdminPrdExtensions({
    one: async (sql: string) => sql.includes('mip_opportunity_commercial_terms')
      ? { min_amount_cents: 0, max_amount_cents: 2500000, currency: 'CNY', amount_unit: 'CNY_CENTS' }
      : { id: 'opportunity-a', owner_user_id: 'owner-a', title: '非空合作机会', value_summary: '完整价值',
          target_summary: '未改目标', description: '第一段\n第二段', scope_type: 'PLATFORM', role_keys: 'connector,strategist',
          tag_ids: 'tag-a', status: 'PUBLISHED', content_safety_status: 'APPROVED', version: 7,
          deadline_at: new Date('2026-12-01T00:00:00Z') },
    query: async (sql: string) => sql.includes('mip_opportunity_locations')
      ? [{ location_type: 'CITY', city_tag_id: cityId, city_name: '上海' }, { location_type: 'REMOTE' }]
      : [],
  })
  return repository.getOpportunityDetail('wx-test', 'opportunity-a')
}

it('maps the actual opportunity response with separate money and value-description columns', async () => {
  const dto = await serializedOpportunity()
  const page = await loadOpportunities({ query: '', status: '', cursor: '', limit: 20, filters: { section: 'opportunities' } },
    async <T>() => ({ items: [dto, { ...dto, id: 'empty-money', commercialTerms: { ...dto.commercialTerms, minAmountCents: null, maxAmountCents: null } },
      { ...dto, id: 'zero-money', commercialTerms: { ...dto.commercialTerms, minAmountCents: 0, maxAmountCents: 0 } }], nextCursor: null }) as T)
  assert.deepEqual(page.sections[0].rows.map(row => [row.value, row.valueSummary]), [['0 ～ 2.5', '完整价值'], ['—', '完整价值'], ['0', '完整价值']])
  assert.equal(page.sections[0].columns.find(column => column.key === 'valueSummary')?.label, '价值说明')
})

describe('opportunity read/edit/save contract', () => {
  it('round trips the actual server serializer without a draft wrapper or presentation fields', async () => {
    const dto = await serializedOpportunity()
    assert.equal(dto.draft, undefined)
    const values = opportunityEditorValues(dto)
    const result = validateContentMutation('mip.admin.opportunities.save', contentFormValues('mip.admin.opportunities.save', values, 'test'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.input.expectedVersion, 7)
    assert.deepEqual(result.input.draft, {
      ownerUserId: 'owner-a', scopeType: 'PLATFORM', title: '非空合作机会', valueSummary: '完整价值',
      targetSummary: '未改目标', description: '第一段\n第二段', cityTagId: undefined, coverAssetId: null,
      commercialTerms: { currency: 'CNY', amountUnit: 'CNY_CENTS', minAmountCents: 0, maxAmountCents: 2500000,
        locations: [{ type: 'CITY', cityTagId: cityId }, { type: 'REMOTE' }] },
      roleKeys: ['connector', 'strategist'], tagIds: ['tag-a'], deadlineAt: '2026-12-01T00:00:00.000Z',
    })
  })
  it('rejects incomplete DTOs rather than opening an empty existing record', async () => {
    const dto = await serializedOpportunity()
    for (const field of ['id', 'version', 'ownerUserId', 'title', 'valueSummary', 'roleKeys', 'tagIds']) {
      const broken = { ...dto }; delete broken[field]
      assert.throws(() => opportunityEditorValues(broken), /详情字段不完整/)
    }
  })
  it('rebases only changed fields and preserves concurrent changes, empty values and false', () => {
    const original = { expectedVersion: 1, draft: { title: '旧', body: '旧内容', amount: 3, flags: true, ids: ['a'] } }
    const local = { expectedVersion: 1, draft: { title: '我改', body: '旧内容', amount: 0, flags: false, ids: [] } }
    const latest = { expectedVersion: 4, draft: { title: '他改', body: '别人新内容', amount: 3, flags: true, ids: ['a'], newField: '新' } }
    assert.deepEqual(rebaseEdit(original, local, latest), {
      expectedVersion: 4, draft: { title: '我改', body: '别人新内容', amount: 0, flags: false, ids: [], newField: '新' },
    })
  })
})
