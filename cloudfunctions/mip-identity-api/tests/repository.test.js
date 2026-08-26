'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createIdentityRepository } = require('../domain/repository')

describe('portable WeChat identity', () => {
  it('captures a hashed union identity on an existing subject without replacing the user', async () => {
    const updates = []
    const repository = createIdentityRepository({
      async one() {
        return {
          id: 'user-1',
          status: 'ACTIVE',
          primary_branch_id: null,
          version: 1,
          identity_id: 'identity-1',
          union_identity_key: null,
        }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_user_identities')) {
              return {
                id: 'identity-1', user_id: 'user-1', identity_key: 'a'.repeat(64),
                closed_identity_key: null, union_identity_key: null,
              }
            }
            return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 1 }
          },
          async query(sql, params) {
            updates.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    })

    const user = await repository.ensureUser({
      appId: 'wx0000000000000001',
      identityKey: 'a'.repeat(64),
      unionIdentityKey: 'b'.repeat(64),
    })
    assert.equal(user.id, 'user-1')
    assert.equal(updates.length, 2)
    assert.match(updates[0].sql, /INSERT INTO mip_membership_chains/)
    assert.match(updates[0].sql, /INSERT[\s\S]+SELECT[\s\S]+ON DUPLICATE KEY UPDATE/)
    assert.deepEqual(updates[0].params, ['wx0000000000000001', 'user-1'])
    assert.match(updates[1].sql, /union_identity_key = COALESCE/)
    assert.deepEqual(updates[1].params, [
      'b'.repeat(64), 'wx0000000000000001', 'identity-1', 'user-1', 'a'.repeat(64),
    ])
  })

  it('rebinds a migrated app-scoped user by union identity only when explicitly enabled', async () => {
    const calls = []
    const migrated = {
      id: 'user-1',
      status: 'ACTIVE',
      primary_branch_id: null,
      version: 7,
      identity_id: 'identity-1',
      union_identity_key: 'b'.repeat(64),
    }
    const repository = createIdentityRepository({
      async one() {
        return null
      },
      async transaction(work) {
        return work({
          async one(sql, params) {
            calls.push({ sql, params })
            return migrated
          },
          async query(sql, params) {
            calls.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }, { allowUnionRebind: true })

    const user = await repository.ensureUser({
      appId: 'wx0000000000000002',
      identityKey: 'c'.repeat(64),
      unionIdentityKey: 'b'.repeat(64),
    })
    assert.equal(user.id, 'user-1')
    assert.match(calls[0].sql, /i\.union_identity_key = \? FOR UPDATE/)
    assert.match(calls[1].sql, /INSERT INTO mip_membership_chains/)
    assert.match(calls[1].sql, /ON DUPLICATE KEY UPDATE/)
    assert.match(calls[2].sql, /SET identity_key = \?/)
    assert.deepEqual(calls[2].params, [
      'c'.repeat(64),
      'wx0000000000000002',
      'identity-1',
      'b'.repeat(64),
    ])
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_users')), false)
  })

  it('fails closed when a known OpenID presents a different union identity', async () => {
    const repository = createIdentityRepository({
      async one() {
        return {
          id: 'user-1',
          status: 'ACTIVE',
          primary_branch_id: null,
          version: 1,
          identity_id: 'identity-1',
          union_identity_key: 'a'.repeat(64),
        }
      },
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_user_identities')) {
              return {
                id: 'identity-1', user_id: 'user-1', identity_key: 'c'.repeat(64),
                closed_identity_key: null, union_identity_key: 'a'.repeat(64),
              }
            }
            return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 1 }
          },
          async query() { return { affectedRows: 1 } },
        })
      },
    })
    await assert.rejects(
      () => repository.ensureUser({
        appId: 'wx0000000000000001',
        identityKey: 'c'.repeat(64),
        unionIdentityKey: 'b'.repeat(64),
      }),
      /IDENTITY_UNION_CONFLICT/,
    )
  })

  it('creates the membership chain immediately after the user in the registration transaction', async () => {
    const transactions = []
    let identityLookup = 0
    const repository = createIdentityRepository({
      async one() {
        identityLookup += 1
        if (identityLookup === 1) return null
        return {
          id: 'user-1',
          status: 'ACTIVE',
          primary_branch_id: null,
          version: 1,
          identity_id: 'identity-1',
          union_identity_key: null,
        }
      },
      async transaction(work) {
        const queries = []
        transactions.push(queries)
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_user_identities')) {
              return {
                id: 'identity-1',
                user_id: 'user-1',
                identity_key: 'a'.repeat(64),
                closed_identity_key: null,
                union_identity_key: null,
              }
            }
            return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 1 }
          },
          async query(sql, params) {
            queries.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }, {
      id: (() => {
        const ids = ['user-1', 'identity-1', 'outbox-1']
        return () => ids.shift()
      })(),
    })

    await repository.ensureUser({
      appId: 'wx0000000000000001',
      identityKey: 'a'.repeat(64),
      unionIdentityKey: null,
    })

    assert.equal(transactions.length, 2)
    assert.match(transactions[0][0].sql, /INSERT INTO mip_users/)
    assert.match(transactions[0][1].sql, /INSERT INTO mip_membership_chains/)
    assert.deepEqual(transactions[0][1].params, ['wx0000000000000001', 'user-1'])
    assert.match(transactions[0][2].sql, /INSERT INTO mip_user_identities/)
  })

  it('fails the registration transaction before identity creation when the chain cannot be inserted', async () => {
    const queries = []
    const committed = []
    const repository = createIdentityRepository({
      async one() { return null },
      async transaction(work) {
        const pending = []
        const result = await work({
          async query(sql) {
            queries.push(sql)
            if (sql.includes('INSERT INTO mip_membership_chains')) {
              throw new Error('CHAIN_INSERT_FAILED')
            }
            pending.push(sql)
            return { affectedRows: 1 }
          },
        })
        committed.push(...pending)
        return result
      },
    }, { id: () => 'user-1' })

    await assert.rejects(
      () => repository.ensureUser({
        appId: 'wx0000000000000001',
        identityKey: 'a'.repeat(64),
        unionIdentityKey: null,
      }),
      /CHAIN_INSERT_FAILED/,
    )
    assert.equal(queries.length, 2)
    assert.match(queries[0], /INSERT INTO mip_users/)
    assert.match(queries[1], /INSERT INTO mip_membership_chains/)
    assert.equal(queries.some(sql => sql.includes('INSERT INTO mip_user_identities')), false)
    assert.deepEqual(committed, [])
  })
})

describe('MIP entitlement repository adapter', () => {
  it('reads the isolated MIP entitlement table', async () => {
    const calls = []
    const repository = createIdentityRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          status: 'ACTIVE',
          starts_at: '2026-01-01T00:00:00.000Z',
          ends_at: '2027-01-01T00:00:00.000Z',
        }
      },
    })

    const result = await repository.loadEntitlement('wx0000000000000001', 'user-1')
    assert.equal(result.source, 'ENTITLEMENT')
    assert.equal(result.entitlement.status, 'ACTIVE')
    assert.match(calls[0].sql, /FROM mip_membership_entitlements/)
    assert.match(calls[0].sql, /status = 'ACTIVE'/)
    assert.match(calls[0].sql, /starts_at <= UTC_TIMESTAMP\(3\)/)
    assert.match(calls[0].sql, /ends_at > UTC_TIMESTAMP\(3\)/)
    assert.deepEqual(calls[0].params, ['wx0000000000000001', 'user-1'])
  })

  it('reports an undeployed entitlement table without granting PLAYER', async () => {
    const repository = createIdentityRepository({
      async one() {
        const error = new Error('missing')
        error.code = 'ER_NO_SUCH_TABLE'
        throw error
      },
    })

    await assert.doesNotReject(async () => {
      assert.deepEqual(
        await repository.loadEntitlement('wx0000000000000001', 'user-1'),
        { source: 'UNAVAILABLE', entitlement: null },
      )
    })
  })
})

describe('public profile visibility', () => {
  it('enforces an app-scoped block in either direction for an existing viewer', async () => {
    const calls = []
    const repository = createIdentityRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return null
      },
      async query() {
        throw new Error('tags must not load for a hidden profile')
      },
    })

    const result = await repository.loadPublicProfile(
      'wx0000000000000001',
      'target-user',
      'viewer-user',
    )

    assert.equal(result, null)
    assert.match(calls[0].sql, /FROM mip_user_blocks visibility_block/)
    assert.match(calls[0].sql, /visibility_block\.app_id = u\.app_id/)
    assert.match(calls[0].sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = u\.id/)
    assert.match(calls[0].sql, /blocker_user_id = u\.id AND visibility_block\.blocked_user_id = \?/)
    assert.deepEqual(calls[0].params, [
      'wx0000000000000001',
      'target-user',
      'viewer-user',
      'viewer-user',
    ])
  })

  it('keeps anonymous public profile lookup independent of the block table', async () => {
    const calls = []
    const repository = createIdentityRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          nickname: '公开用户',
          visibility_json: '{}',
          companies_json: '[]',
          organizations_json: '[]',
        }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    })

    await repository.loadPublicProfile('wx0000000000000001', 'target-user')

    assert.equal(calls[0].sql.includes('mip_user_blocks'), false)
    assert.deepEqual(calls[0].params, ['wx0000000000000001', 'target-user'])
  })
})

describe('profile and primary branch transaction', () => {
  it('writes branch membership, primary branch, profile, and completion event together', async () => {
    const queries = []
    let transactionCount = 0
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 2 }
        }
        if (sql.includes('FROM mip_city_branches')) {
          return { id: '20000000-0000-4000-8000-000000000001', status: 'ACTIVE' }
        }
        if (sql.includes('SELECT version, avatar_asset_id FROM mip_profiles')) {
          return null
        }
        if (sql.includes('SELECT nickname, version FROM mip_profiles')) {
          return { nickname: '测试用户', version: 1 }
        }
        if (sql.includes('SELECT id FROM mip_outbox_events')) {
          return null
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        queries.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createIdentityRepository({
      async transaction(work) {
        transactionCount += 1
        return work(tx)
      },
    }, { id: () => '30000000-0000-4000-8000-000000000001' })

    await repository.updateProfile('wx0000000000000001', 'user-1', {
      expectedVersion: 0,
      expectedUserVersion: 2,
      primaryBranchId: '20000000-0000-4000-8000-000000000001',
      nickname: '测试用户',
      identityStatus: '产品与技术',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      abilityTagIds: [],
    })

    assert.equal(transactionCount, 1)
    assert.equal(queries.some(call => call.sql.includes('INSERT INTO mip_branch_memberships')), true)
    assert.equal(queries.some(call => call.sql.includes('UPDATE mip_users SET primary_branch_id')), true)
    assert.equal(queries.some(call => call.sql.includes('INSERT INTO mip_profiles')), true)
    const profileWrite = queries.find(call => call.sql.includes('INSERT INTO mip_profiles'))
    assert.equal(profileWrite.params[4], '产品与技术')
    assert.equal(queries.some(call => call.sql.includes("'identity.profile_completed'")), true)
  })

  it('accepts only a selectable second-level industry as the single primary industry', async () => {
    const queries = []
    const industryId = '21000000-0000-4000-8000-000000000001'
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 1 }
        }
        if (sql.includes('SELECT version, avatar_asset_id FROM mip_profiles')) {
          return { version: 1, avatar_asset_id: null }
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        queries.push({ sql, params })
        if (sql.includes('FROM mip_tags t')) {
          return [{
            id: industryId,
            kind: 'INDUSTRY',
            selectable: 1,
            parent_id: '21900000-0000-4000-8000-000000000001',
            parent_kind: 'INDUSTRY',
            parent_parent_id: null,
            parent_selectable: 0,
            parent_enabled: 1,
          }]
        }
        return { affectedRows: 1 }
      },
    }
    const repository = createIdentityRepository({
      async transaction(work) {
        return work(tx)
      },
    })

    await repository.updateProfile('wx0000000000000001', 'user-1', {
      expectedVersion: 1,
      nickname: '测试用户',
      identityStatus: '',
      headline: '',
      introduction: '',
      companies: [],
      organizations: [],
      visibility: {},
      primaryIndustryTagId: industryId,
      abilityTagIds: [],
    })

    const primaryWrites = queries.filter(call => call.sql.includes('INSERT INTO mip_profile_tags')
      && call.sql.includes("'PRIMARY_INDUSTRY'"))
    assert.equal(primaryWrites.length, 1)
    assert.deepEqual(primaryWrites[0].params, ['wx0000000000000001', 'user-1', industryId])
  })

  it('rejects a top-level industry group as a profile selection', async () => {
    const industryGroupId = '21900000-0000-4000-8000-000000000001'
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_users')) {
              return { id: 'user-1', status: 'ACTIVE', primary_branch_id: null, version: 1 }
            }
            if (sql.includes('SELECT version, avatar_asset_id FROM mip_profiles')) {
              return { version: 1, avatar_asset_id: null }
            }
            throw new Error(`unexpected one: ${sql}`)
          },
          async query(sql) {
            if (sql.includes('FROM mip_tags t')) {
              return [{
                id: industryGroupId,
                kind: 'INDUSTRY',
                selectable: 0,
                parent_id: null,
              }]
            }
            return { affectedRows: 1 }
          },
        })
      },
    })

    await assert.rejects(
      () => repository.updateProfile('wx0000000000000001', 'user-1', {
        expectedVersion: 1,
        nickname: '测试用户',
        identityStatus: '',
        headline: '',
        introduction: '',
        companies: [],
        organizations: [],
        visibility: {},
        primaryIndustryTagId: industryGroupId,
        abilityTagIds: [],
      }),
      /PROFILE_TAG_INVALID/,
    )
  })
})

describe('phone binding isolation', () => {
  it('updates only the current user row so another user phone unique key cannot be overwritten', async () => {
    const calls = []
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one() { return { id: 'user-1', status: 'ACTIVE' } },
          async query(sql, params) {
            calls.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    })
    await repository.bindPhone('wx0000000000000001', 'user-1', {
      phoneHash: 'a'.repeat(64),
      phoneCiphertext: Buffer.from('ciphertext'),
    })

    assert.match(calls[0].sql, /^UPDATE mip_private_profiles/m)
    assert.doesNotMatch(calls[0].sql, /ON DUPLICATE KEY UPDATE/)
    assert.deepEqual(calls[0].params.slice(-2), ['wx0000000000000001', 'user-1'])
  })

  it('maps a phone unique-key collision to an explicit domain error', async () => {
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one() { return { id: 'user-1', status: 'ACTIVE' } },
          async query() {
            const error = new Error('duplicate')
            error.code = 'ER_DUP_ENTRY'
            throw error
          },
        })
      },
    })
    await assert.rejects(
      () => repository.bindPhone('wx0000000000000001', 'user-1', {
        phoneHash: 'a'.repeat(64),
        phoneCiphertext: Buffer.from('ciphertext'),
      }),
      /PHONE_ALREADY_BOUND/,
    )
  })

  it('does not restore phone data after the user row is closed', async () => {
    let writes = 0
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one() { return { id: 'user-1', status: 'CLOSED' } },
          async query() { writes += 1; return { affectedRows: 1 } },
        })
      },
    })
    await assert.rejects(
      () => repository.bindPhone('wx0000000000000001', 'user-1', {
        phoneHash: 'a'.repeat(64),
        phoneCiphertext: Buffer.from('ciphertext'),
      }),
      /FORBIDDEN/,
    )
    assert.equal(writes, 0)
  })
})

describe('agreement acceptance isolation', () => {
  it('does not append acceptances after the user row is closed', async () => {
    let writes = 0
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one() { return { id: 'user-1', status: 'CLOSED' } },
          async query() { writes += 1; return { affectedRows: 1 } },
        })
      },
    })
    await assert.rejects(
      () => repository.acceptAgreements('wx0000000000000001', 'user-1', [{
        key: 'SERVICE_AGREEMENT', version: 'v1',
      }]),
      /FORBIDDEN/,
    )
    assert.equal(writes, 0)
  })
})
