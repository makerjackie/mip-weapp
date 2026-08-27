'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createIdentityRepository } = require('../domain/repository')

const APP_ID = 'wx1111111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const AVATAR_ID = '22222222-2222-4222-8222-222222222222'

function profileInput() {
  return {
    expectedVersion: 1,
    avatarAssetId: AVATAR_ID,
    nickname: 'MIP 用户',
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [],
    organizations: [],
    visibility: {},
    abilityTagIds: [],
  }
}

describe('profile avatar binding', () => {
  it('validates app, owner, READY state and AVATAR purpose inside the profile transaction', async () => {
    let mediaChecked = false
    const tx = {
      async one(sql, params) {
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE', version: 1, primary_branch_id: null }
        if (sql.includes('FROM mip_profiles')) return { version: 1, avatar_asset_id: null }
        if (sql.includes('FROM mip_media_assets')) {
          mediaChecked = true
          assert.match(sql, /owner_user_id = \?/)
          assert.match(sql, /purpose = 'AVATAR'/)
          assert.match(sql, /status = 'READY'/)
          assert.deepEqual(params, [APP_ID, AVATAR_ID, USER_ID])
          return { id: AVATAR_ID }
        }
        return null
      },
      async query(sql, params) {
        if (sql.includes('UPDATE mip_profiles')) {
          assert.equal(params[4], AVATAR_ID)
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    }
    const repository = createIdentityRepository({ transaction: work => work(tx) })
    await repository.updateProfile(APP_ID, USER_ID, profileInput())
    assert.equal(mediaChecked, true)
  })

  it('rejects a forged or wrong-purpose avatar before updating the profile', async () => {
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE', version: 1, primary_branch_id: null }
        if (sql.includes('FROM mip_profiles')) return { version: 1, avatar_asset_id: null }
        if (sql.includes('FROM mip_media_assets')) return null
        return null
      },
      async query() { throw new Error('profile must not update') },
    }
    const repository = createIdentityRepository({ transaction: work => work(tx) })
    await assert.rejects(
      () => repository.updateProfile(APP_ID, USER_ID, profileInput()),
      /PROFILE_AVATAR_INVALID/,
    )
  })
})
