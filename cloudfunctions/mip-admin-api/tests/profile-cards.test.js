'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createCards } = require('../domain/cards')
const { createProfileCardRepository } = require('../domain/repositories/profile-cards')
const { requestHash } = require('../domain/idempotency')
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
const { authorize } = require('../domain/capabilities')

function service(bindings = [grant], changes = [], repositoryOverrides = {}) {
  return createCards({ access: {
    session: async () => ({ caller: { appId: 'app', userId: 'admin' }, bindings }),
    userAuthorization: async (context, _id, capability) => {
      const scope = { scopeType: 'BRANCH', scopeId: 'branch' }
      return { scope, grant: authorize(context.bindings, capability, scope) }
    },
    mutationAuthorization: () => ({ effectiveGrant: grant, capability: 'users.fields.edit' }),
    audit: (_context, _grant, input) => input,
  }, repository: {
    changeProfileCard: async input => { changes.push(input); return { version: input.expectedVersion + 1 } },
    listProfileCards: async (_app, input) => ({ items: [{ id: 'member', name: 'Test', status: 'ACTIVE', version: 0 }], nextCursor: null, input }),
    ...repositoryOverrides,
  } })
}

function transactionRepository({ profileVersion = 11, updateAffectedRows = 1, onQuery, onOne } = {}) {
  const state = { attemptedWrites: [], committedWrites: [], rolledBackWrites: [], reads: [], audits: [] }
  const tx = {
    one: async (sql, params = []) => {
      state.reads.push({ sql, params })
      if (onOne) return onOne(sql, params, state)
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_users')) return { id: 'member' }
      if (sql.includes('FROM mip_profiles')) return { version: profileVersion }
      return null
    },
    query: async (sql, params = []) => {
      state.attemptedWrites.push({ sql, params })
      if (onQuery) {
        try { return await onQuery(sql, params, state) }
        catch (error) { state.attemptedWrites.pop(); throw error }
      }
      if (sql.startsWith('UPDATE mip_profiles')) return { affectedRows: updateAffectedRows }
      return { affectedRows: 1 }
    },
  }
  const database = {
    transaction: async callback => {
      try {
        const result = await callback(tx)
        state.committedWrites = [...state.attemptedWrites]
        return result
      }
      catch (error) {
        state.rolledBackWrites = [...state.attemptedWrites]
        state.attemptedWrites = [] // A rejected callback rolls the transaction back.
        throw error
      }
    },
  }
  const repository = createProfileCardRepository(database, {
    lockMutation: async () => ({ authorized: true }),
    assertScope: () => {},
    writeAudit: async (transaction, audit) => {
      state.audits.push(audit)
      await transaction.query('INSERT INTO mip_audit_logs (action, resource_id, metadata_json) VALUES (?, ?, ?)', [audit.action, audit.resourceId, JSON.stringify(audit.metadata)])
    },
  })
  return { repository, state }
}

describe('profile-backed card governance', () => {
  it('projects non-empty profile fields and keeps profile and moderation versions distinct', async () => {
    const row = {
      user_id: 'member', nickname: '小林', real_name: '林晓', headline: '产品负责人',
      introduction: '关注长期主义与产品实践。', companies_json: '[{"name":"甲公司","role":"产品负责人"}]',
      organizations_json: '[{"name":"产品社群","role":"发起人"}]', identity_status: '已验证',
      profile_version: 17, avatar_url: 'cloud://avatar', card_status: 'ACTIVE', card_version: 3, reason: '',
    }
    const database = { query: async (sql, params) => {
      assert.match(sql, /p\.version AS profile_version/)
      assert.match(sql, /m\.version, 0\) AS card_version/)
      assert.match(sql, /p\.companies_json, p\.organizations_json/)
      assert.deepEqual(params, ['app', '', '', '', 21])
      return [row]
    } }
    const repository = createProfileCardRepository(database, {})
    const result = await service([grant], [], { listProfileCards: repository.listProfileCards }).listCards({}, {})
    assert.deepEqual(result.items[0], {
      id: 'member', name: '林晓', nickname: '小林', realName: '林晓',
      introduction: '关注长期主义与产品实践。', organizations: [{ name: '产品社群', role: '发起人' }],
      headline: '产品负责人', companies: [{ name: '甲公司', role: '产品负责人' }], identityStatus: '已验证',
      avatarUrl: 'cloud://avatar', profileVersion: 17, status: 'ACTIVE', version: 3, reason: '',
    })
  })

  it('keeps the platform card catalog protected and allows ordinary editing only in the user scope', async () => {
    assert.equal((await service().listCards({}, {})).items[0].id, 'member')
    const branchService = service([{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch' }])
    await assert.rejects(() => branchService.listCards({}, {}), error => error.code === 'FORBIDDEN')
    await branchService.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '修改', companies: [], organizations: [] },
    })
    await assert.rejects(() => service([{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'other' }]).saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17, fields: { nickname: '修改', companies: [], organizations: [] },
    }), error => error.code === 'FORBIDDEN')
  })

  it('validates PROFILE fields and forwards profileVersion into PROFILE_EDIT', async () => {
    const changes = []
    const cards = service([grant], changes)
    await cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      // The row's moderation `version` is 3; profile writes must use `profileVersion` (17).
      fields: {
        realName: ' 林晓 ', nickname: ' 小林 ', headline: '产品负责人',
        introduction: '介绍正文', companies: [{ name: '甲公司', role: '产品负责人' }],
        organizations: [{ name: '产品社群', role: '发起人' }], identityStatus: '已验证',
      },
      idempotencyKey: 'profile-save-17',
    })
    assert.equal(changes[0].kind, 'PROFILE_EDIT')
    assert.equal(changes[0].expectedVersion, 17)
    assert.deepEqual(changes[0].changes, {
      realName: '林晓', nickname: '小林', headline: '产品负责人', introduction: '介绍正文',
      companies: [{ name: '甲公司', role: '产品负责人' }],
      organizations: [{ name: '产品社群', role: '发起人' }], identityStatus: '已验证',
    })
    assert.equal(changes[0].idempotencyKey, 'profile-save-17')
    assert.equal(changes[0].audit.action, 'admin.cards.profile_edit')

    await assert.rejects(() => cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '修改', phone: '13800000000' },
    }), error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '修改', organizations: [{ name: '组织', role: '成员', branchId: 'branch' }] },
    }), error => error.code === 'VALIDATION_FAILED')
    await cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '小林', introduction: '介'.repeat(600), identityStatus: '身'.repeat(32), companies: [], organizations: [] },
    })
    assert.equal(changes[1].changes.introduction.length, 600)
    assert.equal(changes[1].changes.identityStatus.length, 32)
    await assert.rejects(() => cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '小林', introduction: '介'.repeat(601), identityStatus: '身份', companies: [], organizations: [] },
    }), error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => cards.saveCard({}, {
      cardType: 'PROFILE', cardId: 'member', expectedVersion: 17,
      fields: { nickname: '小林', introduction: '介绍', identityStatus: '身'.repeat(33), companies: [], organizations: [] },
    }), error => error.code === 'VALIDATION_FAILED')
    assert.equal(changes.length, 2)
  })

  it('uses profile version compare-and-swap and performs no committed writes on a conflict', async () => {
    const { repository, state } = transactionRepository({ profileVersion: 18 })
    await assert.rejects(() => repository.changeProfileCard({
      appId: 'app', actorUserId: 'admin', cardId: 'member', kind: 'PROFILE_EDIT', expectedVersion: 17,
      changes: { nickname: '小林', companies: [], organizations: [], introduction: '' },
      audit: { action: 'admin.cards.profile_edit', resourceId: 'member' },
    }), error => error.code === 'CONFLICT')
    assert.equal(state.reads.some(({ sql }) => sql.includes('FROM mip_profiles')), true)
    assert.equal(state.reads.some(({ sql }) => sql.includes('mip_profile_card_moderation')), false)
    assert.deepEqual(state.committedWrites, [])
    assert.deepEqual(state.audits, [])

    const cas = transactionRepository({ profileVersion: 17, updateAffectedRows: 0 })
    await assert.rejects(() => cas.repository.changeProfileCard({
      appId: 'app', actorUserId: 'admin', cardId: 'member', kind: 'PROFILE_EDIT', expectedVersion: 17,
      changes: { nickname: '小林', companies: [], organizations: [], introduction: '' },
      audit: { action: 'admin.cards.profile_edit', resourceId: 'member' },
    }), error => error.code === 'CONFLICT')
    assert.deepEqual(cas.state.attemptedWrites, [])
    assert.deepEqual(cas.state.committedWrites, [])
    assert.deepEqual(cas.state.rolledBackWrites.map(({ sql }) => sql.startsWith('UPDATE mip_profiles')), [true])
    assert.deepEqual(cas.state.audits, [])
  })

  it('updates profile fields, records the incremented snapshot and audit in one transaction', async () => {
    const { repository, state } = transactionRepository({ profileVersion: 17 })
    const result = await repository.changeProfileCard({
      appId: 'app', actorUserId: 'admin', cardId: 'member', kind: 'PROFILE_EDIT', expectedVersion: 17,
      changes: {
        realName: '林晓', nickname: '小林', headline: '产品负责人', introduction: '介绍正文',
        companies: [{ name: '甲公司', role: '产品负责人' }],
        organizations: [{ name: '产品社群', role: '发起人' }], identityStatus: '已验证',
      },
      audit: { action: 'admin.cards.profile_edit', resourceType: 'USER', resourceId: 'member' },
    })

    assert.deepEqual(result, { id: 'member', version: 18 })
    const update = state.committedWrites.find(({ sql }) => sql.startsWith('UPDATE mip_profiles'))
    assert.ok(update)
    assert.match(update.sql, /version = version \+ 1/)
    assert.match(update.sql, /WHERE app_id = \? AND user_id = \? AND version = \?/)
    assert.deepEqual(update.params, [
      '林晓', '小林', '产品负责人', '介绍正文',
      JSON.stringify([{ name: '甲公司', role: '产品负责人' }]),
      JSON.stringify([{ name: '产品社群', role: '发起人' }]), '已验证', 'app', 'member', 17,
    ])
    const history = state.committedWrites.find(({ sql }) => sql.includes('INSERT INTO mip_profile_card_history'))
    assert.ok(history)
    assert.match(history.sql, /SELECT app_id, user_id, version, JSON_OBJECT/)
    assert.match(history.sql, /'introduction', introduction/)
    assert.match(history.sql, /'companies', companies_json, 'organizations', organizations_json/)
    assert.deepEqual(history.params, ['app', 'member'])
    assert.deepEqual(state.audits, [{
      action: 'admin.cards.profile_edit', resourceType: 'USER', resourceId: 'member',
      metadata: { fields: ['realName', 'nickname', 'headline', 'introduction', 'companies', 'organizations', 'identityStatus'], version: 18 },
    }])
    assert.equal(state.committedWrites.some(({ sql }) => sql.includes('INSERT INTO mip_audit_logs')), true)
    assert.deepEqual(state.committedWrites.map(({ sql }) => sql.startsWith('UPDATE mip_profiles') ? 'update'
      : sql.includes('INSERT INTO mip_profile_card_history') ? 'history' : 'audit'), ['update', 'history', 'audit'])
  })

  it('replays an identical idempotent profile edit without writing profile, history or audit twice', async () => {
    const changes = { nickname: '小林', companies: [], organizations: [], introduction: '' }
    const input = {
      appId: 'app', actorUserId: 'admin', cardId: 'member', kind: 'PROFILE_EDIT', expectedVersion: 17,
      changes, idempotencyKey: 'profile-save-retry', audit: { action: 'admin.cards.profile_edit', resourceId: 'member' },
    }
    const { repository, state } = transactionRepository({
      onOne: async (sql, params) => {
        if (sql.includes('FROM mip_idempotency_keys')) {
          assert.deepEqual(params, ['app', 'admin', 'admin.cards.profile_edit', 'profile-save-retry'])
          return { request_hash: requestHash({ cardId: 'member', version: 17, changes }), status: 'COMPLETED', response_json: JSON.stringify({ id: 'member', version: 18 }) }
        }
        if (sql.includes('FROM mip_users')) return { id: 'member', primary_branch_id: 'branch' }
        return null
      },
      onQuery: async sql => {
        if (sql.includes('INSERT INTO mip_idempotency_keys')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        throw new Error('replay must not write profile, history or audit')
      },
    })

    assert.deepEqual(await repository.changeProfileCard(input), { id: 'member', version: 18, idempotent: true })
    assert.deepEqual(state.committedWrites, [])
    assert.deepEqual(state.audits, [])
    assert.equal(state.reads.some(({ sql }) => sql.includes('FROM mip_users')), true)
    assert.equal(state.reads.some(({ sql }) => sql.includes('FROM mip_profiles')), false)
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
