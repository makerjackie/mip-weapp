import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadAdminReadPage, type AdminRequest } from './admin-read-pages.ts'

const require = createRequire(import.meta.url)
const { createAdminUserRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/users.js')

it('renders a nonempty serialized server page with all three persisted product roles and its cursor', async () => {
  const request: AdminRequest = async <T>() => JSON.parse(JSON.stringify({ items: [
    { id: 'ordinary', nickname: '普通用户样本', kind: 'NORMAL' },
    { id: 'guest', nickname: '嘉宾样本', kind: 'GUEST' },
    { id: 'player', nickname: '玩家样本', kind: 'PLAYER' },
  ], nextCursor: 'server-cursor' })) as T
  const page = await loadAdminReadPage('users', { query: '', status: '', cursor: null, limit: 20 }, request)
  assert.deepEqual(page.sections[0].rows.map(row => row.role), ['普通用户', '嘉宾', '玩家'])
  assert.equal(page.nextCursor, 'server-cursor')
})

it('renders the actual serialized user-list projection with the prototype column contract', async () => {
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
  const row = page.sections[0].rows[0]
  const columnLabels = page.sections[0].columns.map(column => column.label)
  assert.deepEqual(columnLabels, ['头像', '昵称', '手机号', '当前角色', '行业', '当前身份', '用户等级', '贡献值', '玩家权益状态', '用户注册时间', '玩家到期时间'])
  assert.equal(row.industry, '软件、设计')
  assert.equal(row.profession, '创业者')
  assert.equal(row.contribution, '0')
  assert.equal(row.role, '玩家')
  // 到期时间远超 30 日且不在下个自然月，按分档口径展示「生效中」。
  assert.equal(row.playerStatus, '生效中')
  assert.match(String(row.expiresAt), /2031/)
  assert.equal(row.avatarUrl, 'https://example.com/avatar.png')
  // MIW-124 C1：简介、所属服务器、账号状态列随原型口径移除。
  assert.equal('headline' in row, false)
  assert.equal('branch' in row, false)
  assert.equal('state' in row, false)
})

it('forwards NORMAL as the server role filter and player status buckets to server filters without losing expiry buckets', async () => {
  const captured: Array<Record<string, unknown>> = []
  const request: AdminRequest = async <T>(_action: string, input?: unknown) => {
    captured.push((input ?? {}) as Record<string, unknown>)
    return { items: [], nextCursor: null } as T
  }
  const baseQuery = { query: '', status: '', cursor: null, limit: 20 }
  await loadAdminReadPage('users', { ...baseQuery, filters: { kind: 'NORMAL' } }, request)
  assert.equal((captured[0].filters as Record<string, unknown>).kind, 'NORMAL')
  assert.equal((captured[0].filters as Record<string, unknown>).identity, undefined)

  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRING_THIS_MONTH' } }, request)
  assert.equal((captured[1].filters as Record<string, unknown>).playerLifecycle, 'EXPIRING_THIS_MONTH')
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRED' } }, request)
  assert.equal((captured[2].filters as Record<string, unknown>).playerLifecycle, 'EXPIRED')
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'NEVER' } }, request)
  assert.equal((captured[3].filters as Record<string, unknown>).playerLifecycle, 'NEVER')
  // 服务端旧枚举在 URL 中保留时仍按兼容映射工作。
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'FORMER' } }, request)
  assert.equal((captured[4].filters as Record<string, unknown>).playerLifecycle, 'EXPIRED')
})

it('preserves the server page and displays authoritative expiry buckets without filtering it again', async () => {
  const request: AdminRequest = async <T>() => ({ items: [
    { id: 'next-month', kind: 'PLAYER', membershipStatus: 'NEXT_MONTH', latestEntitlementEndsAt: '2030-02-01T00:00:00Z' },
    { id: 'this-month', kind: 'PLAYER', membershipStatus: 'EXPIRING_THIS_MONTH', latestEntitlementEndsAt: '2030-01-31T16:00:00Z' },
  ], nextCursor: 'page-2' }) as T
  const page = await loadAdminReadPage('users', { query: '', status: '', cursor: null, limit: 20, filters: { playerLifecycle: 'NEXT_MONTH' } }, request)
  assert.equal(page.sections[0].rows.length, 2)
  assert.deepEqual(page.sections[0].rows.map(row => row.playerStatus), ['下个月到期', '本月到期'])
  assert.equal(page.nextCursor, 'page-2')
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
