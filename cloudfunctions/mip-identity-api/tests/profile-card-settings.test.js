'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createIdentityService } = require('../domain/service')
const { loadProfileCardSettings } = require('../domain/profile-card-settings')
describe('profile card publication settings', () => {
  it('returns active template order, mandatory fields and current takedown reason', async () => {
    const result = await loadProfileCardSettings({
      one: async (_sql, params) => { assert.deepEqual(params, ['app', 'member']); return { status: 'TAKEN_DOWN', reason: '违规内容' } },
      query: async sql => { assert.match(sql, /status = 'ACTIVE' ORDER BY sort_order/); return [{ style_key: 'BLUE', name: '蓝色', required_fields_json: '["company"]' }] },
    }, 'app', 'member')
    assert.deepEqual(result, { enabled: false, reason: '违规内容', templates: [{ key: 'BLUE', name: '蓝色', requiredFields: ['company'] }] })
  })
  it('refuses generation and scene resolution when a card is taken down', async () => {
    let writes = 0
    const service = createIdentityService({ repository: {
      ensureUser: async () => ({ id: 'member', status: 'ACTIVE' }), getProfileCardSettings: async () => ({ enabled: false, templates: [] }),
    }, profileCardCodeWriter: () => { writes++; return {} }, profileCardSceneReader: () => 'member', profileRefWriter: () => 'profile' })
    await assert.rejects(() => service.getMyProfileCardCode({ appId: 'app' }), /PROFILE_CARD_UNAVAILABLE/)
    await assert.rejects(() => service.resolveProfileCardScene({ appId: 'app' }, { scene: 'valid' }), /PROFILE_CARD_UNAVAILABLE/)
    assert.equal(writes, 0)
  })
})
