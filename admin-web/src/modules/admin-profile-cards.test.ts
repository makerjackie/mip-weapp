import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardHistoryFields, profileCardsModule, type CardTemplate, type ProfileCard } from './admin-profile-cards.ts'
import type { AdminRequest } from './admin-read-contracts.ts'

describe('profile card management contract', () => {
  it('uses versioned idempotent mutations for template and profile records', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request: AdminRequest = async (action, input) => { calls.push({ action, input }); return {} as never }
    const module = profileCardsModule(request)
    const template: CardTemplate = { id: 'PINK', name: '粉色', requiredFields: ['name'], sortOrder: 2, status: 'ACTIVE', version: 3 }
    await module.saveTemplate(template, { name: '粉色', requiredFields: ['company'], sortOrder: 1 }, 'save-key')
    await module.setTemplateStatus(template, 'status-key')
    await module.moderate({ id: 'member', status: 'ACTIVE', version: 0 } as ProfileCard, '原因', 'take-key')
    await module.moderate({ id: 'member', status: 'TAKEN_DOWN', version: 1 } as ProfileCard, '', 'restore-key')
    assert.deepEqual(calls.map(call => call.action), ['mip.admin.cards.save', 'mip.admin.cards.changeStatus', 'mip.admin.cards.takedown', 'mip.admin.cards.changeStatus'])
    assert.deepEqual(calls[2].input, { cardId: 'member', expectedVersion: 0, reason: '原因', idempotencyKey: 'take-key' })
    assert.deepEqual(calls[3].input, { cardId: 'member', cardType: 'PROFILE', expectedVersion: 1, status: 'ACTIVE', idempotencyKey: 'restore-key' })
  })
  it('renders historical professional fields without leaking raw technical or private fields', () => {
    const fields = cardHistoryFields({ nickname: '昵称', realName: '姓名', companies: [{ name: '公司', role: '设计师' }], email: 'private@example.com', avatarAssetId: 'internal-id' })
    assert.ok(fields.some(field => field.value === '公司 · 设计师'))
    assert.ok(!JSON.stringify(fields).includes('private@example.com'))
    assert.ok(!JSON.stringify(fields).includes('internal-id'))
  })
})
