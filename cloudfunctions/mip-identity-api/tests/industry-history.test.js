'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createIdentityRepository } = require('../domain/repository')
const { normalizeProfileInput, profileDto } = require('../domain/service')

const appId = 'wx-industry-history'
const userId = '11111111-1111-4111-8111-111111111111'
const tagId = '22222222-2222-4222-8222-222222222222'
const groupId = '33333333-3333-4333-8333-333333333333'
const input = { expectedVersion: 1, nickname: '新昵称', identityStatus: '', headline: '', introduction: '', companies: [], organizations: [], visibility: {}, abilityTagIds: [] }

function fixture({ enabled = 0, parentEnabled = 1, retained = true } = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE', version: 1 }
      if (sql.includes('SELECT version, avatar_asset_id')) return { version: 1, avatar_asset_id: null, visibility_json: {} }
      if (sql.includes('FROM mip_profile_tags')) {
        assert.deepEqual(params, [appId, userId, tagId])
        assert.match(sql, /relation = 'PRIMARY_INDUSTRY' AND tag_id = \?/)
        return retained ? { tag_id: tagId } : null
      }
      return null
    },
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_tags t')) {
        assert.deepEqual(params, [appId, tagId])
        assert.match(sql, /FOR SHARE/)
        return [{ id: tagId, kind: 'INDUSTRY', enabled, selectable: 1, parent_id: groupId, parent_kind: 'INDUSTRY', parent_parent_id: null, parent_selectable: 0, parent_enabled: parentEnabled }]
      }
      return { affectedRows: 1 }
    },
  }
  return { calls, repository: createIdentityRepository({ transaction: work => work(tx) }) }
}

describe('retained industry choices', () => {
  for (const state of [{ enabled: 0, parentEnabled: 1 }, { enabled: 1, parentEnabled: 0 }]) {
    it(`retains an existing industry when enabled=${state.enabled}, parent=${state.parentEnabled}`, async () => {
      const { repository, calls } = fixture(state)
      await repository.updateProfile(appId, userId, { ...input, primaryIndustryTagId: tagId })
      const saved = calls.find(call => call.sql.includes('INSERT INTO mip_profile_tags'))
      assert.deepEqual(saved.params, [appId, userId, tagId])
    })

    it(`rejects a new disabled choice when enabled=${state.enabled}, parent=${state.parentEnabled}`, async () => {
      const { repository, calls } = fixture({ ...state, retained: false })
      await assert.rejects(() => repository.updateProfile(appId, userId, { ...input, primaryIndustryTagId: tagId }), /PROFILE_TAG_INVALID/)
      assert.equal(calls.some(call => call.sql.includes('UPDATE mip_profiles')), false)
    })
  }

  it('accepts a newly selected active industry without a previous relation', async () => {
    const { repository, calls } = fixture({ enabled: 1, retained: false })
    await repository.updateProfile(appId, userId, { ...input, primaryIndustryTagId: tagId })
    assert.equal(calls.some(call => call.sql.includes('SELECT tag_id FROM mip_profile_tags')), false)
  })

  it('preserves omitted industry fields from old clients, and clears only on explicit null', async () => {
    for (const primaryIndustryTagId of [undefined, null]) {
      const { repository, calls } = fixture()
      const normalized = normalizeProfileInput({ ...input, primaryIndustryTagId })
      assert.equal(normalized.primaryIndustryTagId, primaryIndustryTagId)
      await repository.updateProfile(appId, userId, normalized)
      const deletion = calls.find(call => call.sql.includes('DELETE FROM mip_profile_tags'))
      assert.equal(deletion.sql.includes("'PRIMARY_INDUSTRY'"), primaryIndustryTagId === null)
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_profile_tags')), false)
    }
  })

  it('loads and projects the stored label even after disable, independently of the active catalog', async () => {
    const repository = createIdentityRepository({
      async one(sql) {
        return sql.includes('FROM mip_users') ? { id: userId, status: 'ACTIVE', version: 1 } : null
      },
      async query(sql, params) {
        if (!sql.includes('FROM mip_profile_tags')) return []
        assert.deepEqual(params, [appId, userId])
        assert.match(sql, /pt\.relation = 'PRIMARY_INDUSTRY' OR t\.enabled = 1/)
        return [{ tag_id: tagId, relation: 'PRIMARY_INDUSTRY', label: '电子通讯' }]
      },
    })
    const profile = profileDto(await repository.loadFacts(appId, userId))
    assert.equal(profile.primaryIndustryTagId, tagId)
    assert.equal(profile.primaryIndustryLabel, '电子通讯')
  })
})
