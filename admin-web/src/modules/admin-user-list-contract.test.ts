import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadAdminReadPage, type AdminRequest } from './admin-read-pages.ts'

const require = createRequire(import.meta.url)
const { createAdminUserRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/users.js')

it('renders the actual serialized user-list projection with industry, profession, zero contribution and expiry', async () => {
  const repository = createAdminUserRepository({ query: async () => [{
    id: 'user-a', status: 'ACTIVE', is_player: 1, nickname: '验收用户', identity_status: '创业者',
    industry_names: '软件、设计', avatar_url: 'https://example.com/avatar.png', contribution_balance: 0,
    phone_verified_at: new Date('2030-01-01T00:00:00Z'), latest_entitlement_ends_at: new Date('2031-01-01T00:00:00Z'),
    created_at: new Date('2030-01-01T00:00:00Z'), updated_at: new Date('2030-01-02T00:00:00Z'),
  }] }, {
    visibleBranchesWhere: () => ({ sql: '1 = 1', params: [] }),
    repositorySupport: { iso: (value: unknown) => value ? new Date(String(value)).toISOString() : null, json: (value: unknown, fallback: unknown) => value ? JSON.parse(String(value)) : fallback, escapeLike: (value: string) => value },
  })
  const payload = JSON.parse(JSON.stringify(await repository.listUsers('app-a', { platform: true, branchIds: [], eventIds: [] }, {}, 20)))
  const request: AdminRequest = async <T>() => payload as T
  const page = await loadAdminReadPage('users', { query: '', status: '', cursor: null, limit: 20 }, request)
  assert.equal(page.sections[0].rows[0].industry, '软件、设计')
  assert.equal(page.sections[0].rows[0].profession, '创业者')
  assert.equal(page.sections[0].rows[0].contribution, '0')
  assert.equal(page.sections[0].rows[0].membership, '有效')
  assert.match(String(page.sections[0].rows[0].expiresAt), /2031/)
  assert.equal(page.sections[0].rows[0].avatarUrl, 'https://example.com/avatar.png')
})

it('requests phones only with permission and displays the masked value', async () => {
  let captured: unknown
  const request: AdminRequest = async <T>(_action: string, input?: unknown) => {
    captured = input
    return { items: [{ id: 'user-a', phoneNumber: '+86 13800138000', phoneNumberMasked: '+86 138****8000' }], nextCursor: null } as T
  }
  const query = { query: '', status: '', cursor: null, limit: 20 }
  const page = await loadAdminReadPage('users', query, request, { hasCapability: capability => capability === 'users.phone.read' })
  assert.equal((captured as { includePhone?: boolean }).includePhone, true)
  assert.equal(page.sections[0].rows[0].phone, '+86 138****8000')
  await loadAdminReadPage('users', query, request, { hasCapability: () => false })
  assert.equal((captured as { includePhone?: boolean }).includePhone, undefined)
})
