import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  APP_ID_MIGRATION_ACTION,
  APP_ID_MIGRATION_EXCLUSIONS,
  appIdMigrationPolicy,
  assertNoAppIdMigrationResidue,
  remapAppScopedRow,
  transformAppScopedTable,
  transformPrivateProfileRow,
} from '../scripts/lib/mip-app-id-migration-transform.mjs'

const require = createRequire(import.meta.url)
const {
  hashPhone,
  protectContact,
  protectPhone,
  revealContact,
  revealPhone,
} = require('../cloudfunctions/mip-identity-api/lib/private-data.js')

const sourceAppId = 'wx1111111111111111'
const targetAppId = 'wx2222222222222222'
const sourcePhoneEncryptionKey = 'source-phone-encryption-key-with-32-characters'
const targetPhoneEncryptionKey = 'target-phone-encryption-key-with-32-characters'
const userId = 'user-fixture-1'
const mapping = {
  sourceAppId,
  sourcePhoneEncryptionKey,
  targetAppId,
  targetPhoneEncryptionKey,
}

describe('MIP AppID migration transformation', () => {
  it('maps only rows from the confirmed source AppID without mutating input', () => {
    const source = { app_id: sourceAppId, id: 'row-1', nested: { status: 'ACTIVE' } }
    const result = remapAppScopedRow(source, mapping)

    expect(result).toEqual({ ...source, app_id: targetAppId })
    expect(source.app_id).toBe(sourceAppId)
    expect(() => remapAppScopedRow({ ...source, app_id: targetAppId }, mapping))
      .toThrow('MIGRATION_SOURCE_APP_SCOPE_MISMATCH')
    expect(() => remapAppScopedRow(source, { ...mapping, targetAppId: sourceAppId }))
      .toThrow('MIGRATION_APP_ID_MAPPING_MUST_CHANGE')
  })

  it('re-encrypts phone and card contacts with the identity service format and target AAD', () => {
    const phoneInfo = { countryCode: '86', purePhoneNumber: '13800138000' }
    const sourcePhone = protectPhone(phoneInfo, sourcePhoneEncryptionKey, { appId: sourceAppId, userId })
    const sourceWechat = protectContact('mip-contact', sourcePhoneEncryptionKey, { appId: sourceAppId, userId })
    const sourceEmail = protectContact('member@example.test', sourcePhoneEncryptionKey, { appId: sourceAppId, userId })
    const sourceAddress = protectContact('深圳市福田区', sourcePhoneEncryptionKey, { appId: sourceAppId, userId })
    const source = {
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: sourcePhone.phoneHash,
      phone_ciphertext: sourcePhone.phoneCiphertext,
      phone_verified_at: '2026-08-28T00:00:00.000Z',
      wechat_ciphertext: sourceWechat,
      email_ciphertext: sourceEmail,
      address_ciphertext: sourceAddress,
    }

    const result = transformPrivateProfileRow(source, mapping)

    expect(result.app_id).toBe(targetAppId)
    expect(result.phone_hash).toBe(hashPhone(phoneInfo, targetPhoneEncryptionKey, { appId: targetAppId }))
    expect(result.phone_hash).not.toBe(source.phone_hash)
    expect(result.phone_ciphertext).not.toEqual(source.phone_ciphertext)
    expect(revealPhone(result.phone_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('+86:13800138000')
    expect(revealContact(result.wechat_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('mip-contact')
    expect(revealContact(result.email_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('member@example.test')
    expect(revealContact(result.address_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('深圳市福田区')
    expect(() => revealPhone(result.phone_ciphertext, sourcePhoneEncryptionKey, {
      appId: sourceAppId,
      userId,
    })).toThrow()
    expect(source.app_id).toBe(sourceAppId)
    expect(source.phone_ciphertext).toBe(sourcePhone.phoneCiphertext)
  })

  it('keeps an unbound private profile empty and rejects partial phone state', () => {
    const empty = transformPrivateProfileRow({
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: null,
      phone_ciphertext: null,
      phone_verified_at: null,
      wechat_ciphertext: null,
      email_ciphertext: null,
      address_ciphertext: null,
    }, mapping)
    expect(empty).toMatchObject({
      app_id: targetAppId,
      phone_hash: null,
      phone_ciphertext: null,
      phone_verified_at: null,
    })

    expect(() => transformPrivateProfileRow({
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: 'a'.repeat(64),
      phone_ciphertext: null,
      phone_verified_at: null,
    }, mapping)).toThrow('MIGRATION_PRIVATE_PROFILE_PHONE_STATE_INVALID')
  })

  it('accepts the strict Node Buffer JSON shape produced by private JSONL exports', () => {
    const phoneInfo = { countryCode: '86', purePhoneNumber: '13800138000' }
    const sourcePhone = protectPhone(phoneInfo, sourcePhoneEncryptionKey, {
      appId: sourceAppId,
      userId,
    })
    const sourceWechat = protectContact('mip-contact', sourcePhoneEncryptionKey, {
      appId: sourceAppId,
      userId,
    })
    const result = transformPrivateProfileRow({
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: sourcePhone.phoneHash,
      phone_ciphertext: sourcePhone.phoneCiphertext.toJSON(),
      phone_verified_at: '2026-08-28T00:00:00.000Z',
      wechat_ciphertext: sourceWechat.toJSON(),
    }, mapping)

    expect(revealPhone(result.phone_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('+86:13800138000')
    expect(revealContact(result.wechat_ciphertext, targetPhoneEncryptionKey, {
      appId: targetAppId,
      userId,
    })).toBe('mip-contact')
  })

  it('fails with sanitized errors when source ciphertext or keys cannot authenticate', () => {
    const secretMarker = 'must-not-appear-in-errors'
    const sourcePhone = protectPhone(
      { countryCode: '86', purePhoneNumber: '13800138000' },
      sourcePhoneEncryptionKey,
      { appId: sourceAppId, userId },
    )
    const input = {
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: sourcePhone.phoneHash,
      phone_ciphertext: sourcePhone.phoneCiphertext,
      phone_verified_at: '2026-08-28T00:00:00.000Z',
    }

    let message = ''
    try {
      transformPrivateProfileRow(input, {
        ...mapping,
        sourcePhoneEncryptionKey: `${secretMarker}-wrong-source-key-value`,
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe('MIGRATION_PHONE_DECRYPTION_FAILED')
    expect(message).not.toContain(secretMarker)
    expect(message).not.toContain(sourceAppId)
    expect(message).not.toContain(userId)
  })

  it('excludes source-bound credentials and operational claims without returning their rows', () => {
    expect(APP_ID_MIGRATION_EXCLUSIONS).toMatchObject({
      mip_notification_grants: 'SOURCE_APP_NOTIFICATION_GRANT',
      mip_idempotency_keys: 'TEMPORARY_IDEMPOTENCY_CLAIM',
      mip_admin_export_tickets: 'TEMPORARY_EXPORT_TICKET',
      mip_web_bff_requests: 'TEMPORARY_BFF_NONCE',
      mip_event_checkin_credentials: 'SOURCE_APP_CHECKIN_CREDENTIAL',
      mip_event_invitation_links: 'SOURCE_APP_INVITATION_CREDENTIAL',
    })
    expect(appIdMigrationPolicy('mip_profiles')).toEqual({
      action: APP_ID_MIGRATION_ACTION.MIGRATE,
    })

    const result = transformAppScopedTable({
      ...mapping,
      tableName: 'mip_notification_grants',
      rows: [{ app_id: sourceAppId, recipient_ciphertext: Buffer.from('private') }],
    })
    expect(result).toEqual({
      action: APP_ID_MIGRATION_ACTION.EXCLUDE,
      excludedCount: 1,
      reason: 'SOURCE_APP_NOTIFICATION_GRANT',
      rows: [],
      tableName: 'mip_notification_grants',
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('clears retained-row references to old temporary credentials', () => {
    const registrations = transformAppScopedTable({
      ...mapping,
      tableName: 'mip_event_registrations',
      rows: [{ app_id: sourceAppId, id: 'registration-1', ticket_hash: 'a'.repeat(64) }],
    })
    const checkins = transformAppScopedTable({
      ...mapping,
      tableName: 'mip_event_checkins',
      rows: [{ app_id: sourceAppId, id: 'checkin-1', credential_id: 'credential-1' }],
    })
    const campaigns = transformAppScopedTable({
      ...mapping,
      tableName: 'mip_message_campaigns',
      rows: [{
        app_id: sourceAppId,
        id: 'campaign-1',
        active_dispatch_id: 'dispatch-1',
        publish_idempotency_key: 'request-1',
        publish_request_hash: 'b'.repeat(64),
      }],
    })
    const schedules = transformAppScopedTable({
      ...mapping,
      tableName: 'mip_knowledge_ingestion_schedules',
      rows: [{
        app_id: sourceAppId,
        id: 'schedule-1',
        lease_token: 'lease-1',
        lease_due_at: '2026-08-28T00:00:00.000Z',
        leased_until: '2026-08-28T00:05:00.000Z',
      }],
    })

    expect(registrations.rows[0]).toMatchObject({ app_id: targetAppId, ticket_hash: null })
    expect(checkins.rows[0]).toMatchObject({ app_id: targetAppId, credential_id: null })
    expect(campaigns.rows[0]).toMatchObject({
      active_dispatch_id: null,
      publish_idempotency_key: null,
      publish_request_hash: null,
    })
    expect(schedules.rows[0]).toMatchObject({
      lease_token: null,
      lease_due_at: null,
      leased_until: null,
    })
  })

  it('audits target scope, nested source AppID residue and temporary credentials without exposing values', () => {
    expect(assertNoAppIdMigrationResidue({
      ...mapping,
      tables: {
        mip_notification_grants: [],
        mip_profiles: [{ app_id: targetAppId, id: 'profile-1' }],
      },
    })).toEqual({ rowCount: 1, tableCount: 2 })

    expect(() => assertNoAppIdMigrationResidue({
      ...mapping,
      tables: { mip_profiles: [{ app_id: targetAppId, metadata: { old: sourceAppId } }] },
    })).toThrow('MIGRATION_RESIDUE_SOURCE_APP_ID:mip_profiles')
    expect(() => assertNoAppIdMigrationResidue({
      ...mapping,
      tables: { mip_notification_grants: [{ app_id: targetAppId }] },
    })).toThrow('MIGRATION_RESIDUE_EXCLUDED_TABLE:mip_notification_grants')
    expect(() => assertNoAppIdMigrationResidue({
      ...mapping,
      tables: { mip_event_registrations: [{ app_id: targetAppId, ticket_hash: 'secret-ticket' }] },
    })).toThrow('MIGRATION_RESIDUE_TEMPORARY_CREDENTIAL:mip_event_registrations.ticket_hash')
  })

  it('rejects non-MIP tables and malformed AppIDs without echoing inputs', () => {
    expect(() => appIdMigrationPolicy('other_users')).toThrow('MIGRATION_TABLE_NOT_ALLOWED')
    expect(() => remapAppScopedRow(
      { app_id: 'invalid-app-id' },
      { ...mapping, sourceAppId: 'invalid-app-id' },
    )).toThrow('MIGRATION_SOURCE_APP_ID_INVALID')
  })
})
