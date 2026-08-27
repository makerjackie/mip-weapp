import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createIdentityService } = require('../cloudfunctions/mip-identity-api/domain/service.js')
const privateData = require('../cloudfunctions/mip-identity-api/lib/private-data.js')

describe('MIP profile card privacy contract', () => {
  it('encrypts card contacts and decrypts them only with the same scoped context', () => {
    const context = { appId: 'wx-test', userId: 'user-test' }
    const encrypted = privateData.protectContact('hello@example.com', 'a'.repeat(32), context)
    expect(encrypted.toString('utf8')).not.toContain('hello@example.com')
    expect(privateData.revealContact(encrypted, 'a'.repeat(32), context)).toBe('hello@example.com')
    expect(() => privateData.revealContact(encrypted, 'a'.repeat(32), { ...context, userId: 'other' })).toThrow()
  })

  it('never puts private contacts in the public profile DTO', async () => {
    const service = createIdentityService({
      repository: {
        ensureUser: async () => ({ id: 'u1', status: 'ACTIVE' }),
        loadFacts: async () => ({
          user: { id: 'u1', version: 1, status: 'ACTIVE', primary_branch_id: null },
          profile: { version: 1, nickname: '用户', visibility_json: { cardContacts: { email: true } } },
          privateProfile: { email_ciphertext: Buffer.from('secret') },
          profileTags: [],
          roles: [],
          acceptances: [],
        }),
        loadPublicProfile: async () => ({
          profile: { nickname: '用户', visibility_json: { cardContacts: { email: true } } },
          tags: [],
        }),
        findUserByIdentity: async () => null,
        loadEntitlement: async () => ({ source: 'NONE' }),
      },
      profileRefReader: () => 'u1',
    })
    const result = await service.getPublicProfile({ appId: 'wx-test' }, { profileRef: 'p1.x' })
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('privateContact')
  })

  it('returns the bound phone only through the authenticated self profile DTO', async () => {
    const service = createIdentityService({
      repository: {
        ensureUser: async () => ({ id: 'u1', status: 'ACTIVE' }),
        loadFacts: async () => ({
          user: { id: 'u1', version: 1, status: 'ACTIVE', primary_branch_id: null },
          profile: { version: 1, nickname: '用户', visibility_json: {} },
          privateProfile: { phone_verified_at: '2026-08-28T00:00:00Z', phone_ciphertext: Buffer.from('cipher') },
          profileTags: [],
          roles: [],
          acceptances: [],
        }),
      },
      revealPhone: () => '+86:18800001111',
    })
    const result = await service.getProfile({ appId: 'wx-test' })
    expect(result.privateContact).toMatchObject({
      phone: '18800001111',
      phoneMasked: '188****1111',
      phoneBound: true,
    })
  })

  it('normalizes profile and contact card fields into one server mutation', async () => {
    let received: Record<string, unknown> | undefined
    const service = createIdentityService({
      repository: {
        ensureUser: async () => ({ id: 'u1', version: 1, status: 'ACTIVE', primary_branch_id: null }),
        updateCard: async (_appId: string, _userId: string, input: Record<string, unknown>) => {
          received = input
        },
        loadFacts: async () => ({
          user: { id: 'u1', version: 1, status: 'ACTIVE', primary_branch_id: null },
          profile: { version: 2, nickname: '用户', visibility_json: {} },
          privateProfile: null,
          profileTags: [],
          roles: [],
          acceptances: [],
        }),
        loadEntitlement: async () => ({ source: 'NONE' }),
      },
      protectContact: (value: string) => Buffer.from(value),
    })

    await service.updateCard({ appId: 'wx-test' }, { input: {
      expectedVersion: 1,
      realName: '张三',
      companies: [{ name: '示例公司', role: '负责人' }],
      organizations: [{ name: '深圳分会', role: '玩家' }],
      wechat: 'mip-demo',
      email: 'demo@example.com',
      address: '深圳市福田区',
      visibility: { cardContacts: { phone: true, email: true } },
    } })

    expect(received).toMatchObject({
      expectedVersion: 1,
      realName: '张三',
      companies: [{ name: '示例公司', role: '负责人' }],
      organizations: [{ name: '深圳分会', role: '玩家' }],
      wechat: 'mip-demo',
      email: 'demo@example.com',
      address: '深圳市福田区',
      visibility: {
        cardContacts: { phone: true, wechat: false, email: true, address: false },
      },
    })
  })
})
