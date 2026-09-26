'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCards } = require('../domain/cards')
const { createProfileCardRepository } = require('../domain/repositories/profile-cards')
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
function service(bindings = [grant], changes = []) {
  return createCards({ access: {
    session: async () => ({ caller: { appId: 'app', userId: 'admin' }, bindings }),
    mutationAuthorization: () => ({ effectiveGrant: grant, capability: 'users.fields.edit' }),
    audit: (_context, _grant, input) => input,
  }, repository: {
    changeProfileCard: async input => { changes.push(input); return { version: input.expectedVersion + 1 } },
    listProfileCards: async (_app, input) => ({ items: [{ id: 'member', name: 'Test', status: 'ACTIVE', version: 0 }], nextCursor: null, input }),
  } })
}
describe('profile-backed card governance', () => {
  it('returns actual cards and requires a platform grant', async () => {
    assert.equal((await service().listCards({}, {})).items[0].id, 'member')
    await assert.rejects(() => service([{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch' }]).listCards({}, {}), error => error.code === 'FORBIDDEN')
  })
  it('validates template style, mandatory fields, ordering and moderation reason', async () => {
    const changes = []
    const cards = service([grant], changes)
    await cards.saveCard({}, { cardType: 'TEMPLATE', cardId: 'PINK', expectedVersion: 1, fields: { name: '粉色', requiredFields: ['name', 'company'], sortOrder: 3 } })
    assert.deepEqual(changes[0].changes, { name: '粉色', requiredFields: ['name', 'company'], sortOrder: 3 })
    await assert.rejects(() => cards.saveCard({}, { cardType: 'TEMPLATE', cardId: 'OTHER', fields: {} }), error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => cards.takedownCard({}, { cardId: 'member', expectedVersion: 0, reason: '' }), error => error.code === 'VALIDATION_FAILED')
    await cards.takedownCard({}, { cardId: 'member', expectedVersion: 0, reason: '违规内容' })
    assert.equal(changes[1].changes.status, 'TAKEN_DOWN')
    await cards.changeCardStatus({}, { cardId: 'member', cardType: 'PROFILE', expectedVersion: 1, status: 'ACTIVE' })
    assert.equal(changes[2].changes.status, 'ACTIVE')
  })
  it('locks authorization and checks the current version before writing', async () => {
    const calls = []
    const tx = { one: async sql => sql.includes('mip_users') ? { id: 'member' } : { version: 2 }, query: async sql => { calls.push(sql); return { affectedRows: 1 } } }
    const repo = createProfileCardRepository({ transaction: fn => fn(tx) }, {
      lockMutation: async () => { calls.push('lock'); return {} }, assertScope: () => calls.push('scope'), writeAudit: async () => calls.push('audit'),
    })
    await assert.rejects(() => repo.changeProfileCard({ appId: 'app', actorUserId: 'admin', cardId: 'member', kind: 'PROFILE', expectedVersion: 1, changes: { status: 'TAKEN_DOWN', reason: 'reason' } }), error => error.code === 'CONFLICT')
    assert.deepEqual(calls, ['lock', 'scope'])
  })
})
