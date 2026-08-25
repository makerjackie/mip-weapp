import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildOwnerCandidateQuery,
  buildOwnerRoleUpsertQuery,
  buildOwnerVerificationQuery,
  currentAgreementVersions,
  resolveOwnerPhoneHash,
  selectOwnerCandidateId,
} from '../scripts/lib/mip-owner-bootstrap.mjs'

const require = createRequire(import.meta.url)
const { protectPhone } = require('../cloudfunctions/mip-identity-api/lib/private-data.js')

const root = path.resolve(import.meta.dirname, '..')
const appId = 'wx1111111111111111'
const otherAppId = 'wx2222222222222222'
const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const demoUserId = '33333333-3333-4333-8333-333333333333'
const phone = '13900000000'
const phoneEncryptionKey = 'owner-bootstrap-test-key-with-at-least-32-characters'

function collectSqlRelations(sql: string) {
  return [...new Set([...sql.matchAll(/\b(?:INSERT\s+INTO|FROM|(?:INNER\s+)?JOIN)\s+`?([a-z_]\w*)`?/gi)]
    .map(match => match[1].toLowerCase()))].sort()
}

function getThrownError(action: () => unknown) {
  try {
    action()
  }
  catch (error) {
    return error
  }
  throw new Error('expected action to fail')
}

describe('MIP owner bootstrap by verified phone', () => {
  it('uses the identity function normalization and AppID-scoped hash implementation', () => {
    const resolved = resolveOwnerPhoneHash({ appId, ownerPhone: phone, phoneEncryptionKey })
    const identityValue = protectPhone(
      { countryCode: '86', purePhoneNumber: phone },
      phoneEncryptionKey,
      { appId, userId },
    )

    expect(resolved).toBe(identityValue.phoneHash)
    expect(resolveOwnerPhoneHash({ appId, ownerPhone: `+86${phone}`, phoneEncryptionKey })).toBe(resolved)
    expect(resolveOwnerPhoneHash({ appId: otherAppId, ownerPhone: phone, phoneEncryptionKey }))
      .not
      .toBe(resolved)
  })

  it('fails closed for absent or malformed local phone configuration without echoing it', () => {
    expect(() => resolveOwnerPhoneHash({ appId, ownerPhone: '', phoneEncryptionKey }))
      .toThrow('MIP_OWNER_PHONE is missing or invalid')

    const malformed = 'not-a-phone-value'
    const error = getThrownError(() => resolveOwnerPhoneHash({ appId, ownerPhone: malformed, phoneEncryptionKey }))
    expect(String(error)).not.toContain(malformed)
    expect(() => resolveOwnerPhoneHash({ appId, ownerPhone: phone, phoneEncryptionKey: 'short' }))
      .toThrow('MIP_PHONE_ENCRYPTION_KEY is missing or invalid')
  })

  it('uses all current default or configured agreement versions', () => {
    expect(currentAgreementVersions('')).toEqual([
      { key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' },
      { key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' },
    ])
    expect(currentAgreementVersions(JSON.stringify([{
      key: 'SERVICE_AGREEMENT',
      label: '用户协议',
      version: 'v2',
      documentPath: '/packages/member/user-agreement/index',
    }]))).toEqual([{ key: 'SERVICE_AGREEMENT', version: 'v2' }])
    expect(() => currentAgreementVersions('[]')).toThrow('MIP_AGREEMENTS_JSON is invalid')
  })

  it('selects only an active, complete, non-demo user with verified phone and every agreement', () => {
    const phoneHash = 'a'.repeat(64)
    const queryOptions = {
      agreements: currentAgreementVersions(''),
      appId,
      demoUserIds: [demoUserId],
      phoneHash,
      userId,
    }
    const query = buildOwnerCandidateQuery(queryOptions)

    expect(query).toContain(`u.app_id = '${appId}'`)
    expect(query).toContain('u.status = \'ACTIVE\'')
    expect(query).toContain('u.primary_branch_id IS NOT NULL')
    expect(query).toContain('CHAR_LENGTH(TRIM(profile.nickname)) > 0')
    expect(query).toContain(`private_profile.phone_hash = '${phoneHash}'`)
    expect(query).toContain('private_profile.phone_verified_at IS NOT NULL')
    expect(query).toContain(`u.id = '${userId}'`)
    expect(query).toContain(`u.id NOT IN ('${demoUserId}')`)
    expect(query).toContain('setting_key LIKE \'demo_seed_manifest%\'')
    expect(query).toContain('JSON_EXTRACT(demo_manifest.value_json, \'$.recordIds.users\')')
    expect(query).toContain('agreement.agreement_key = \'SERVICE_AGREEMENT\'')
    expect(query).toContain('agreement.agreement_version = \'draft-2026-08-24\'')
    expect(query).toContain('agreement.agreement_key = \'PRIVACY_POLICY\'')
    expect(query).toContain('LIMIT 2')
    expect(query).not.toContain(phone)
  })

  it('revalidates the selected owner in static MIP-only SQL before and after the role upsert', () => {
    const queryOptions = {
      agreements: currentAgreementVersions(''),
      appId,
      demoUserIds: [demoUserId],
      phoneHash: 'a'.repeat(64),
      userId,
    }
    const candidateQuery = buildOwnerCandidateQuery(queryOptions)
    const roleUpsertQuery = buildOwnerRoleUpsertQuery(queryOptions)
    const verificationQuery = buildOwnerVerificationQuery(queryOptions)

    expect(roleUpsertQuery).toContain('INSERT INTO mip_admin_role_bindings')
    expect(roleUpsertQuery).toContain(') SELECT')
    expect(roleUpsertQuery).toContain('ON DUPLICATE KEY UPDATE')
    expect(verificationQuery).toContain('FROM mip_admin_role_bindings binding')
    expect(verificationQuery).toContain('binding.status = \'ACTIVE\'')

    for (const query of [roleUpsertQuery, verificationQuery]) {
      expect(query).toContain(`u.id = '${userId}'`)
      expect(query).toContain('u.status = \'ACTIVE\'')
      expect(query).toContain('u.primary_branch_id IS NOT NULL')
      expect(query).toContain('CHAR_LENGTH(TRIM(profile.nickname)) > 0')
      expect(query).toContain('private_profile.phone_verified_at IS NOT NULL')
      expect(query).toContain(`u.id NOT IN ('${demoUserId}')`)
      expect(query).toContain('setting_key LIKE \'demo_seed_manifest%\'')
      expect(query).toContain('agreement.agreement_key = \'SERVICE_AGREEMENT\'')
      expect(query).toContain('agreement.agreement_key = \'PRIVACY_POLICY\'')
    }

    const expectedRelations = {
      candidate: [
        'mip_agreement_acceptances',
        'mip_app_settings',
        'mip_private_profiles',
        'mip_profiles',
        'mip_users',
      ],
      upsert: [
        'mip_admin_role_bindings',
        'mip_agreement_acceptances',
        'mip_app_settings',
        'mip_private_profiles',
        'mip_profiles',
        'mip_users',
      ],
      verification: [
        'mip_admin_role_bindings',
        'mip_agreement_acceptances',
        'mip_app_settings',
        'mip_private_profiles',
        'mip_profiles',
        'mip_users',
      ],
    }
    expect(collectSqlRelations(candidateQuery)).toEqual(expectedRelations.candidate)
    expect(collectSqlRelations(roleUpsertQuery)).toEqual(expectedRelations.upsert)
    expect(collectSqlRelations(verificationQuery)).toEqual(expectedRelations.verification)
    expect([candidateQuery, roleUpsertQuery, verificationQuery].every(query => !query.includes('${'))).toBe(true)
    expect(Object.values(expectedRelations).flat().every(relation => relation.startsWith('mip_'))).toBe(true)
  })

  it('requires a validated selected user for mutating and verification queries without echoing it', () => {
    const invalidUserId = 'sensitive-invalid-owner-id'
    const queryOptions = {
      agreements: currentAgreementVersions(''),
      appId,
      demoUserIds: [demoUserId],
      phoneHash: 'a'.repeat(64),
      userId: invalidUserId,
    }

    for (const builder of [buildOwnerRoleUpsertQuery, buildOwnerVerificationQuery]) {
      for (const selectedUserId of [undefined, '', invalidUserId]) {
        const error = getThrownError(() => builder({ ...queryOptions, userId: selectedUserId }))
        expect(String(error)).toContain('Selected owner query configuration is invalid')
        expect(String(error)).not.toContain(invalidUserId)
        expect(String(error)).not.toContain(queryOptions.phoneHash)
      }
    }
  })

  it('requires exactly one candidate and enforces an optional user-id match without leaking IDs', () => {
    expect(selectOwnerCandidateId({ data: { rows: [{ candidateId: userId }] } })).toBe(userId)
    expect(selectOwnerCandidateId({ data: { rows: [{ candidate_id: userId }] } }, userId)).toBe(userId)
    expect(() => selectOwnerCandidateId({ data: { rows: [] } })).toThrow(/exactly one/)
    expect(() => selectOwnerCandidateId({
      data: { rows: [{ candidateId: userId }, { candidateId: otherUserId }] },
    })).toThrow(/exactly one/)

    const error = getThrownError(() => selectOwnerCandidateId(
      { data: { rows: [{ candidateId: userId }] } },
      otherUserId,
    ))
    expect(String(error)).not.toContain(userId)
    expect(String(error)).not.toContain(otherUserId)
  })

  it('reads the phone only from local configuration and keeps identity facts out of output', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/bootstrap-owner.mjs'), 'utf8')
    const helperSource = fs.readFileSync(path.join(root, 'scripts/lib/mip-owner-bootstrap.mjs'), 'utf8')
    const isolationSource = fs.readFileSync(path.join(root, 'scripts/mip-isolation-check.mjs'), 'utf8')
    const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    const resultArtifact = source.slice(
      source.indexOf('fs.writeFileSync(path.join(root, \'.tmp\', \'bootstrap-owner-result.json\')'),
      source.indexOf('console.log(\'[mip-admin-bootstrap]'),
    )
    const sensitiveCallWrapper = source.slice(
      source.indexOf('function callOwnerCloudbase'),
      source.indexOf('function collectFieldValues'),
    )

    expect(source).toContain('ownerPhone: env.MIP_OWNER_PHONE')
    expect(source).not.toContain('argumentValue(\'--phone=\')')
    expect(source).toContain('callOwnerCloudbase')
    expect(source).toContain('buildOwnerRoleUpsertQuery(selectedOwnerOptions)')
    expect(source).toContain('buildOwnerVerificationQuery(selectedOwnerOptions)')
    expect(source).toContain('if (audit?.success === false)')
    expect(source).not.toContain('selectedCandidateQuery')
    expect(source).not.toMatch(/\b(?:FROM|JOIN)\s*\(\s*\$\{/)
    expect(helperSource).not.toMatch(/\b(?:FROM|JOIN)\s*\(\s*\$\{/)
    expect(isolationSource).toContain('\'scripts/lib/mip-owner-bootstrap.mjs\'')
    expect(source).toContain('environment ID were not persisted')
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:phoneHash|selectedUserId|userId)/)
    expect(sensitiveCallWrapper).toContain('catch {')
    expect(sensitiveCallWrapper).not.toContain('error instanceof Error')
    expect(sensitiveCallWrapper).not.toContain('JSON.stringify(args)')
    expect(resultArtifact).not.toMatch(/(?:phone|hash|appId|envId|userId)/i)
    expect(example.match(/^MIP_OWNER_PHONE=$/gm)).toHaveLength(1)
  })
})
