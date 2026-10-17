import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { loadAdminReadPage, type AdminRequest } from './admin-read-pages.ts'

const require = createRequire(import.meta.url)
const { createAdminUserRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/users.js')

const DAY_MS = 24 * 60 * 60 * 1000

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

it('maps identity=NORMAL to the web contract filter and player status buckets to server enums', async () => {
  const captured: Array<Record<string, unknown>> = []
  const request: AdminRequest = async <T>(_action: string, input?: unknown) => {
    captured.push((input ?? {}) as Record<string, unknown>)
    return { items: [], nextCursor: null } as T
  }
  const baseQuery = { query: '', status: '', cursor: null, limit: 20 }
  await loadAdminReadPage('users', { ...baseQuery, filters: { kind: 'NORMAL' } }, request)
  assert.equal((captured[0].filters as Record<string, unknown>).identity, 'NORMAL')
  // 服务端 kind 参数不携带 NORMAL：上游不再收到 kind 过滤。
  assert.equal((captured[0].filters as Record<string, unknown>).kind, undefined)

  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRING_THIS_MONTH' } }, request)
  assert.equal((captured[1].filters as Record<string, unknown>).playerLifecycle, 'CURRENT')
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRED' } }, request)
  assert.equal((captured[2].filters as Record<string, unknown>).playerLifecycle, 'FORMER')
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'NEVER' } }, request)
  assert.equal((captured[3].filters as Record<string, unknown>).playerLifecycle, 'NEVER')
  // 服务端旧枚举在 URL 中保留时仍按兼容映射工作。
  await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'FORMER' } }, request)
  assert.equal((captured[4].filters as Record<string, unknown>).playerLifecycle, 'FORMER')
})

it('applies expiry buckets on the returned page and distinguishes former and never players', async () => {
  const now = Date.now()
  // 取下个自然月内距当前 30 日以上的日期，确保「下个月到期」不受 30 日窗口挤压。
  const anchor = new Date(now)
  anchor.setDate(1)
  anchor.setMonth(anchor.getMonth() + 1)
  const daysInAnchorMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
  let nextMonth = new Date(anchor.getFullYear(), anchor.getMonth(), daysInAnchorMonth, 12)
  for (let day = 1; day <= daysInAnchorMonth; day += 1) {
    const candidate = new Date(anchor.getFullYear(), anchor.getMonth(), day, 12)
    if (candidate.getTime() - now > 30 * DAY_MS) {
      nextMonth = candidate
      break
    }
  }
  const request: AdminRequest = async <T>() => ({
    items: [
      { id: 'user-soon', kind: 'PLAYER', latestEntitlementEndsAt: new Date(now + 10 * DAY_MS).toISOString() },
      { id: 'user-next-month', kind: 'PLAYER', latestEntitlementEndsAt: nextMonth.toISOString() },
      { id: 'user-active', kind: 'PLAYER', latestEntitlementEndsAt: new Date(now + 200 * DAY_MS).toISOString() },
      { id: 'user-former', kind: 'GUEST', playerNumber: 7, firstPlayerAt: new Date(now - 90 * DAY_MS).toISOString() },
      { id: 'user-never', kind: 'GUEST' },
    ],
    nextCursor: null,
  }) as T
  const baseQuery = { query: '', status: '', cursor: null, limit: 20 }
  const page = await loadAdminReadPage('users', baseQuery, request)
  assert.deepEqual(page.sections[0].rows.map(row => row.playerStatus), ['本月到期', '下个月到期', '生效中', '已到期未续费', '—'])

  const expiring = await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRING_THIS_MONTH' } }, request)
  assert.deepEqual(expiring.sections[0].rows.map(row => row.detailId), ['user-soon'])

  const former = await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'EXPIRED' } }, request)
  assert.deepEqual(former.sections[0].rows.map(row => row.detailId), ['user-former'])
  assert.equal(former.sections[0].rows[0].role, '嘉宾')

  const never = await loadAdminReadPage('users', { ...baseQuery, filters: { playerLifecycle: 'NEVER' } }, request)
  assert.deepEqual(never.sections[0].rows.map(row => row.detailId), ['user-never'])
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
