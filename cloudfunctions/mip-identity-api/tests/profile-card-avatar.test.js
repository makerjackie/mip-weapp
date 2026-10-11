'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createIdentityRepository } = require('../domain/repository')

const AVATAR_ID = '5a0f1c2e-1111-4222-8333-444455556666'

function createRepositoryWithTx({ current, avatar }) {
  const updates = []
  const repository = createIdentityRepository({
    async transaction(work) {
      return work({
        async one(sql) {
          if (sql.includes('FROM mip_media_assets')) {
            return avatar === undefined ? { id: current.avatar_asset_id } : avatar
          }
          if (sql.includes('FROM mip_users')) {
            return { id: 'user-1', status: 'ACTIVE' }
          }
          return current
        },
        async query(sql, params) {
          updates.push({ sql, params })
          return { affectedRows: 1 }
        },
      })
    },
  })
  return { repository, updates }
}

function baseUpdate() {
  return {
    expectedVersion: 3,
    realName: '铭龙',
    companies: [{ name: '深度互娱', role: '创始人' }],
    organizations: [],
    wechat: 'DYM888',
    email: 'dym@example.com',
    address: '',
    visibility: { cardContacts: { phone: true, wechat: true, email: true, address: false } },
  }
}

describe('profile card update avatar binding', () => {
  it('persists a validated AVATAR asset alongside card fields', async () => {
    const { repository, updates } = createRepositoryWithTx({
      current: { version: 3, avatar_asset_id: null, visibility_json: '{}' },
      avatar: { id: AVATAR_ID },
    })
    await repository.updateCard('wx0000000000000001', 'user-1', { ...baseUpdate(), avatarAssetId: AVATAR_ID }, () => 'cipher')
    const update = updates.find(item => item.sql.includes('UPDATE mip_profiles'))
    assert.ok(update, 'expected mip_profiles update')
    assert.match(update.sql, /avatar_asset_id = \?/)
    assert.equal(update.params[3], AVATAR_ID)
  })

  it('keeps the current avatar when the input omits avatarAssetId', async () => {
    const { repository, updates } = createRepositoryWithTx({
      current: { version: 3, avatar_asset_id: 'current-avatar', visibility_json: '{}' },
      avatar: undefined,
    })
    await repository.updateCard('wx0000000000000001', 'user-1', baseUpdate(), () => 'cipher')
    const update = updates.find(item => item.sql.includes('UPDATE mip_profiles'))
    assert.equal(update.params[3], 'current-avatar')
  })

  it('rejects avatar assets that are not owned READY AVATAR media', async () => {
    const { repository } = createRepositoryWithTx({
      current: { version: 3, avatar_asset_id: null, visibility_json: '{}' },
      avatar: null,
    })
    await assert.rejects(
      () => repository.updateCard('wx0000000000000001', 'user-1', { ...baseUpdate(), avatarAssetId: AVATAR_ID }, () => 'cipher'),
      /PROFILE_AVATAR_INVALID/,
    )
  })
})
