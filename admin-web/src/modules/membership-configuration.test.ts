import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { configurationDraft, demoMembershipAgreement, membershipConfiguration } from './membership-configuration.ts'
import type { AdminRequest } from './admin-read-contracts.ts'

describe('membership configuration contracts', () => {
  it('preserves versions and retry keys for edits and agreement publication', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request: AdminRequest = async (action, input) => { calls.push({ action, input }); return {} as never }
    const api = membershipConfiguration(request)
    const item = { id: 'level', name: '测试', version: 4, status: 'ACTIVE' }
    await api.save('levels', item, { name: '修改' }, 'retry')
    await api.saveAgreement(3, demoMembershipAgreement, 'agreement-retry')
    assert.deepEqual(calls[0], { action: 'mip.admin.growth.saveLevel', input: { levelId: 'level', expectedVersion: 4, draft: { name: '修改' }, idempotencyKey: 'retry' } })
    assert.deepEqual(calls[1], { action: 'mip.admin.membershipAgreement.save', input: { expectedVersion: 3, draft: demoMembershipAgreement, idempotencyKey: 'agreement-retry' } })
  })
  it('keeps demo examples explicit and inactive until the administrator enables them', () => {
    for (const kind of ['levels', 'benefits', 'badges'] as const) {
      const draft = configurationDraft(kind, null, true)
      assert.equal(draft.status, 'DRAFT')
      assert.match(String(draft.name), /演示/)
    }
    assert.equal(demoMembershipAgreement.isDemo, true)
    assert.match(demoMembershipAgreement.body, /不作为正式会员服务承诺/)
  })
  it('preserves existing level benefit associations when editing', () => {
    const draft = configurationDraft('levels', { id: 'level', name: '等级', version: 0, status: 'ACTIVE', benefits: [{ id: 'benefit' }] })
    assert.deepEqual(draft.benefitIds, ['benefit'])
  })
  it('targets the user agreement without changing the membership document', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const api = membershipConfiguration(async (action, input) => { calls.push({ action, input }); return {} as never })
    await api.agreement('user')
    await api.saveAgreement(1, demoMembershipAgreement, 'user-retry', 'user')
    assert.deepEqual(calls.map(call => (call.input as Record<string, unknown>).document), ['user', 'user'])
  })

})
