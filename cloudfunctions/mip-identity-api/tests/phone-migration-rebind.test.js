'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { createIdentityRepository } = require('../domain/repository')

const appId = 'wx0000000000000001'
const currentUserId = '10000000-0000-4000-8000-000000000001'
const targetUserId = '10000000-0000-4000-8000-000000000002'
const currentIdentityKey = 'a'.repeat(64)
const targetIdentityKey = 'b'.repeat(64)
const caller = { appId, identityKey: currentIdentityKey, unionIdentityKey: null }
const phone = { phoneHash: 'c'.repeat(64), phoneCiphertext: Buffer.from('trusted-phone') }

function migrationDatabase(overrides = {}) {
  const calls = []
  const state = {
    phoneOwner: {
      user_id: targetUserId,
      phone_ciphertext: Buffer.from('migrated-phone'),
      phone_verified_at: new Date('2026-08-28T00:00:00.000Z'),
    },
    currentUser: {
      id: currentUserId,
      status: 'ACTIVE',
      closed_at: null,
      primary_branch_id: null,
      version: 1,
      created_at: new Date('2026-08-28T00:00:00.000Z'),
      created_recently: 1,
    },
    currentPrivate: {
      phone_hash: null,
      phone_ciphertext: null,
      phone_verified_at: null,
      wechat_ciphertext: null,
      email_ciphertext: null,
      address_ciphertext: null,
    },
    chain: { version: 1 },
    referenceHit: null,
    outbox: [{
      id: 'outbox-1',
      event_type: 'identity.user_registered',
      source_version: 1,
      status: 'PENDING',
      attempts: 0,
      lease_expires_at: null,
      delivered_at: null,
    }],
    targetUser: { id: targetUserId, status: 'ACTIVE', closed_at: null },
    currentIdentities: [{
      id: 'identity-current',
      provider: 'WECHAT_MINIPROGRAM',
      identity_key: currentIdentityKey,
      closed_identity_key: null,
      union_identity_key: null,
    }],
    targetIdentities: [{
      id: 'identity-target',
      provider: 'WECHAT_MINIPROGRAM',
      identity_key: targetIdentityKey,
      closed_identity_key: null,
      union_identity_key: null,
    }],
    existingClaim: null,
    paidEntitlement: { id: 'entitlement-1' },
    failWriteContains: '',
    ...overrides,
  }
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('WHERE app_id = ? AND phone_hash = ?')) return state.phoneOwner
      if (sql.includes('FROM mip_users') && sql.includes('created_recently')) return state.currentUser
      if (sql.includes('FROM mip_private_profiles') && sql.includes('wechat_ciphertext')) return state.currentPrivate
      if (sql.includes('FROM mip_membership_chains')) return state.chain
      if (/FROM mip_[a-z_]+ WHERE app_id = \? AND \? IN \(/.test(sql)) {
        return state.referenceHit
      }
      if (sql.includes('FROM mip_users') && sql.includes('status, closed_at')) return state.targetUser
      if (sql.includes('FROM mip_users')) return { id: currentUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_audit_logs')) return state.existingClaim
      if (sql.includes('FROM mip_membership_entitlements')) return state.paidEntitlement
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('FROM mip_user_identities') && sql.includes('ORDER BY id')) {
        return params[1] === currentUserId ? state.currentIdentities : state.targetIdentities
      }
      if (sql.includes('FROM mip_agreement_acceptances')) return []
      if (sql.includes('FROM mip_outbox_events') && sql.includes('ORDER BY id')) return state.outbox
      if (state.failWriteContains && sql.includes(state.failWriteContains)) return { affectedRows: 0 }
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    database: {
      async transaction(work) {
        return work(tx)
      },
    },
  }
}

function repositoryFor(state) {
  return createIdentityRepository(state.database, { allowPhoneMigrationRebind: true })
}

describe('paid member phone migration rebind', () => {
  it('moves the caller identity to the paid member and closes only the pristine temporary user', async () => {
    const state = migrationDatabase()
    await repositoryFor(state).bindPhone(caller, currentUserId, phone)

    const writes = state.calls.filter(call => call.kind === 'query')
    const closeIdentity = writes.find(call => call.sql.includes('SET identity_key = ?, closed_identity_key = ?'))
    const moveIdentity = writes.find(call => call.sql.includes('SET identity_key = ?, union_identity_key = ?'))
    assert.equal(closeIdentity.params[1], targetIdentityKey)
    assert.equal(closeIdentity.params.includes(currentIdentityKey), true)
    assert.equal(moveIdentity.params[0], currentIdentityKey)
    assert.equal(moveIdentity.params.includes(targetUserId), true)
    assert.equal(writes.some(call => call.sql.includes("SET status = 'CLOSED'")), true)
    assert.equal(writes.some(call => call.sql.includes("SET status = 'CANCELLED'")), true)
    assert.equal(writes.some(call => call.sql.includes('IDENTITY_PHONE_MIGRATION_REBOUND')), true)
  })

  it('keeps the ordinary unique-key collision behavior when the migration switch is disabled', async () => {
    let lookups = 0
    const repository = createIdentityRepository({
      async transaction(work) {
        return work({
          async one() { lookups += 1; return { id: currentUserId, status: 'ACTIVE' } },
          async query() {
            const error = new Error('duplicate')
            error.code = 'ER_DUP_ENTRY'
            throw error
          },
        })
      },
    })
    await assert.rejects(
      () => repository.bindPhone(caller, currentUserId, phone),
      /PHONE_ALREADY_BOUND/,
    )
    assert.equal(lookups, 1)
  })

  it('uses ordinary phone binding when the enabled migration path finds no other owner', async () => {
    const state = migrationDatabase({ phoneOwner: null })
    await repositoryFor(state).bindPhone(caller, currentUserId, phone)
    assert.equal(state.calls.some(call => call.sql.includes('UPDATE mip_private_profiles SET')), true)
    assert.equal(state.calls.some(call => call.sql.includes('IDENTITY_PHONE_MIGRATION_REBOUND')), false)
  })

  it('does not claim an account without an effective paid order entitlement', async () => {
    const state = migrationDatabase({ paidEntitlement: null })
    await assert.rejects(
      () => repositoryFor(state).bindPhone(caller, currentUserId, phone),
      /PHONE_ALREADY_BOUND/,
    )
    assert.equal(state.calls.some(call => call.sql.includes("SET status = 'CLOSED'")), false)
  })

  it('fails closed when the temporary user has profile or other business data', async () => {
    const profileState = migrationDatabase({
      currentPrivate: {
        phone_hash: null,
        phone_ciphertext: null,
        phone_verified_at: null,
        wechat_ciphertext: Buffer.from('wechat'),
        email_ciphertext: null,
        address_ciphertext: null,
      },
    })
    await assert.rejects(
      () => repositoryFor(profileState).bindPhone(caller, currentUserId, phone),
      /PHONE_MIGRATION_REBIND_FAILED/,
    )

    const businessState = migrationDatabase({
      referenceHit: { found: 1 },
    })
    await assert.rejects(
      () => repositoryFor(businessState).bindPhone(caller, currentUserId, phone),
      /PHONE_MIGRATION_REBIND_FAILED/,
    )
  })

  it('fails closed for stale temporary users, identity mismatch, or an existing claim audit', async () => {
    for (const overrides of [
      { currentUser: { id: currentUserId, status: 'ACTIVE', closed_at: null, primary_branch_id: null, version: 1, created_recently: 0 } },
      { currentIdentities: [{ id: 'identity-current', provider: 'WECHAT_MINIPROGRAM', identity_key: 'd'.repeat(64), closed_identity_key: null, union_identity_key: null }] },
      { existingClaim: { id: 1 } },
    ]) {
      const state = migrationDatabase(overrides)
      await assert.rejects(
        () => repositoryFor(state).bindPhone(caller, currentUserId, phone),
        /PHONE_MIGRATION_REBIND_FAILED/,
      )
    }
  })

  it('rolls back when a concurrent write makes any guarded update affect zero rows', async () => {
    for (const failWriteContains of [
      'SET identity_key = ?, closed_identity_key = ?',
      'SET identity_key = ?, union_identity_key = ?',
      "SET status = 'CLOSED'",
      "SET status = 'CANCELLED'",
      'INSERT INTO mip_audit_logs',
    ]) {
      const state = migrationDatabase({ failWriteContains })
      await assert.rejects(
        () => repositoryFor(state).bindPhone(caller, currentUserId, phone),
        /PHONE_MIGRATION_REBIND_FAILED/,
      )
    }
  })

  it('retains delivered registration history but rejects an in-flight registration event', async () => {
    const delivered = migrationDatabase({
      outbox: [{ id: 'outbox-1', event_type: 'identity.user_registered', source_version: 1, status: 'DELIVERED', attempts: 1, lease_expires_at: null, delivered_at: new Date() }],
    })
    await repositoryFor(delivered).bindPhone(caller, currentUserId, phone)
    assert.equal(delivered.calls.some(call => call.sql.includes("SET status = 'CANCELLED'")), false)

    const processing = migrationDatabase({
      outbox: [{ id: 'outbox-1', event_type: 'identity.user_registered', source_version: 1, status: 'PROCESSING', attempts: 1, lease_expires_at: new Date(), delivered_at: null }],
    })
    await assert.rejects(
      () => repositoryFor(processing).bindPhone(caller, currentUserId, phone),
      /PHONE_MIGRATION_REBIND_FAILED/,
    )
  })

  it('keeps foreign keys enabled and never deletes migration records', () => {
    const source = fs.readFileSync(path.join(__dirname, '../domain/repository.js'), 'utf8')
    assert.doesNotMatch(source, /FOREIGN_KEY_CHECKS/i)
    assert.doesNotMatch(source, /DELETE\s+FROM\s+mip_(?:users|user_identities|private_profiles)/i)
    assert.match(source, /FROM mip_user_identities[\s\S]*FOR UPDATE/)
    assert.doesNotMatch(source, /INFORMATION_SCHEMA/)
    assert.match(source, /PHONE_MIGRATION_USER_REFERENCE_CHECKS/)
    assert.match(source, /SELECT 1 AS found FROM mip_orders WHERE app_id = \? AND \? IN \(user_id\)/)
  })
})
