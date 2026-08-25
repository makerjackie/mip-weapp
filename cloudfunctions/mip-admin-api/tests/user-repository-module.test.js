'use strict'

const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const { describe, it } = require('node:test')

const { createAdminUserRepository } = require('../domain/repositories/users')

function userListRow(id, updatedAt) {
  return {
    id,
    status: 'ACTIVE',
    primary_branch_id: 'branch-a',
    user_version: 2,
    nickname: '用户',
    headline: '简介',
    introduction: '',
    visibility_json: '{"headline":true}',
    profile_version: 3,
    phone_ciphertext: Buffer.from('encrypted'),
    phone_verified_at: new Date('2026-08-01T00:00:00.000Z'),
    branch_name: '广州分会',
    city_name: '广州',
    current_level_id: 'level-a',
    level_name: '一级',
    experience_balance: 20,
    controls: 'ALLOWLIST',
    is_player: 1,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date(updatedAt),
  }
}

function createFixture({ one, query, assertUserMutationScope } = {}) {
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ type: 'one', sql, params })
      return one ? one(sql, params) : null
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params })
      return query ? query(sql, params) : []
    },
    async transaction(work) {
      calls.push({ type: 'transaction' })
      return work(this)
    },
  }
  const repository = createAdminUserRepository(database, {
    assertUserMutationScope(authorization, row, authorizedScope) {
      calls.push({ type: 'scope', authorization, row, authorizedScope })
      if (assertUserMutationScope) {
        assertUserMutationScope(authorization, row, authorizedScope)
      }
    },
    createId: () => 'control-a',
    async lockMutationAuthorization(_tx, input) {
      calls.push({ type: 'lock', input })
      return { locked: true }
    },
    repositorySupport: {
      codeError(code) {
        return Object.assign(new Error(code), { code })
      },
      escapeLike(value) {
        return value.replace(/[\\%_]/g, '\\$&')
      },
      iso(value) {
        if (!value) {
          return null
        }
        const date = value instanceof Date ? value : new Date(value)
        return Number.isFinite(date.getTime()) ? date.toISOString() : null
      },
      json(value, fallback = {}) {
        if (value === null || value === undefined) {
          return fallback
        }
        if (typeof value === 'object') {
          return value
        }
        try {
          return JSON.parse(value)
        }
        catch {
          return fallback
        }
      },
    },
    visibleBranchesWhere(visibility) {
      calls.push({ type: 'visibility', visibility })
      return { sql: 'u.primary_branch_id IN (?)', params: ['branch-a'] }
    },
    async writeAudit(_tx, audit) {
      calls.push({ type: 'audit', audit })
    },
  })
  return { calls, repository }
}

describe('admin user repository module', () => {
  it('keeps the extracted seam limited to the existing five repository methods', () => {
    const { repository } = createFixture()
    assert.deepEqual(Object.keys(repository).sort(), [
      'getUserDetail',
      'getUserScope',
      'listUsers',
      'setUserControl',
      'updateUserFields',
    ])
  })

  it('preserves visibility, filters, SQL projection and cursor pagination', async () => {
    const rows = [
      userListRow('user-b', '2026-08-24T02:00:00.000Z'),
      userListRow('user-a', '2026-08-24T01:00:00.000Z'),
    ]
    const { calls, repository } = createFixture({ query: async () => rows })
    const visibility = { platform: false, branchIds: ['branch-a'], eventIds: [] }
    const page = await repository.listUsers('wx-app', visibility, {
      status: 'ACTIVE',
      branchId: 'branch-a',
      levelId: 'level-a',
      experienceMin: 10,
      experienceMax: 30,
      kind: 'PLAYER',
      controlType: 'ALLOWLIST',
      phoneBound: 'BOUND',
      profileComplete: 'COMPLETE',
      joinedWithinDays: 30,
      createdFrom: '2026-08-01 00:00:00.000',
      createdTo: '2026-08-24 23:59:59.999',
      query: '用户_%',
    }, 1)

    assert.deepEqual(calls.find(call => call.type === 'visibility').visibility, visibility)
    const read = calls.find(call => call.type === 'query')
    assert.match(read.sql, /FROM mip_users u/)
    assert.match(read.sql, /mip_membership_entitlements/)
    assert.match(read.sql, /mip_user_access_controls/)
    assert.match(read.sql, /ORDER BY u\.updated_at DESC, u\.id DESC LIMIT \?/)
    assert.ok(read.params.includes('%用户\\_\\%%'))
    assert.equal(read.params.at(-1), 2)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].id, 'user-b')
    assert.equal(page.items[0].kind, 'PLAYER')
    assert.deepEqual(page.items[0].visibility, { headline: true })
    assert.equal(typeof page.nextCursor, 'string')
  })

  it('runs locked scope authorization before profile writes and preserves audit ordering', async () => {
    const current = {
      id: 'user-a',
      status: 'ACTIVE',
      primary_branch_id: 'branch-a',
      user_version: 2,
      profile_version: 3,
      nickname: '原昵称',
      headline: '',
      introduction: '',
      visibility_json: '{}',
    }
    const audit = { action: 'admin.users.fields.update' }
    const authorizedScope = { scopeType: 'BRANCH', scopeId: 'branch-a' }
    const { calls, repository } = createFixture({
      one: async () => current,
      query: async () => ({ affectedRows: 1 }),
      assertUserMutationScope(authorization, row, scope) {
        assert.deepEqual(authorization, { locked: true })
        assert.equal(row, current)
        assert.equal(scope, authorizedScope)
      },
    })
    const result = await repository.updateUserFields({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      userId: 'user-a',
      expectedVersion: 3,
      fields: { nickname: '新昵称', visibility: { headline: false } },
      authorizedScope,
      audit,
    })

    assert.deepEqual(result, { userId: 'user-a', version: 4 })
    assert.deepEqual(calls.map(call => call.type), [
      'transaction',
      'lock',
      'one',
      'scope',
      'query',
      'audit',
    ])
    const write = calls.find(call => call.type === 'query')
    assert.match(write.sql, /UPDATE mip_profiles/)
    assert.deepEqual(write.params, [
      '新昵称',
      null,
      null,
      '{"headline":false}',
      'wx-app',
      'user-a',
      3,
    ])
    assert.equal(calls.at(-1).audit, audit)
  })

  it('fails closed at the injected user-scope check before access-control writes or audit', async () => {
    const conflict = Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' })
    const { calls, repository } = createFixture({
      one: async () => ({ id: 'user-a', status: 'ACTIVE', primary_branch_id: 'branch-b' }),
      query: async () => ({ affectedRows: 1 }),
      assertUserMutationScope() { throw conflict },
    })

    await assert.rejects(() => repository.setUserControl({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      userId: 'user-a',
      controlType: 'BLOCKLIST',
      active: true,
      reason: '违反社区规则',
      authorizedScope: { scopeType: 'BRANCH', scopeId: 'branch-a' },
      audit: { action: 'admin.users.access.activate' },
    }), error => error === conflict)
    assert.equal(calls.some(call => call.type === 'query'), false)
    assert.equal(calls.some(call => call.type === 'audit'), false)
  })
})
