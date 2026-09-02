import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { AdminUser, AdminUserDetail } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  createAdminUserListRequest,
  parseAdminUserDetail,
  parseAdminUserPage,
} from '../src/modules/mip-admin/user-records'

vi.mock('../src/platform/storage/cloud-media', () => ({
  resolveCloudFileUrls: vi.fn(),
}))

vi.mock('../src/modules/mip-admin/cloudbase-transport', () => ({
  cloudbaseAdminTransport: { request: vi.fn() },
}))

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'user-a',
    status: 'ACTIVE',
    kind: 'PLAYER',
    nickname: '林然',
    headline: '产品经理',
    introduction: '负责产品设计。',
    primaryBranchId: 'branch-a',
    branchName: '深圳分会',
    cityName: '深圳',
    phoneBound: true,
    phoneNumber: null,
    controls: [],
    levelId: 'level-a',
    levelName: '一级',
    experience: 120,
    visibility: { influence: true },
    userVersion: 3,
    profileVersion: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function detail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...user(),
    primaryBranchOptions: [
      { id: 'branch-a', name: '深圳分会', cityName: '深圳' },
      { id: 'branch-b', name: '广州分会', cityName: '广州' },
    ],
    companies: [{ name: '示例公司', role: '产品经理' }],
    organizations: [],
    membership: {
      status: 'ACTIVE',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
      isCurrent: true,
      isScheduled: false,
    },
    growth: { levelName: '一级', experience: 120, contribution: 30, coin: 8 },
    counts: {
      registrations: 4,
      attended: 3,
      orders: 2,
      opportunities: 1,
      cooperationCards: 2,
      superCases: 1,
    },
    influence: {
      guestCount: 3,
      interactionCount: 5,
      interestCount: 7,
      visitorCount: 11,
    },
    tags: [{ id: 'tag-a', kind: 'INDUSTRY', relation: 'PRIMARY_INDUSTRY', label: '企业服务' }],
    roles: [{
      roleKey: 'BRANCH_ADMIN',
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      grantedAt: '2026-08-02T00:00:00.000Z',
    }],
    relatedRecords: {
      superCases: [{
        id: 'case-a',
        title: '增长项目',
        summary: '项目摘要',
        status: 'PUBLISHED',
        updatedAt: '2026-08-20T00:00:00.000Z',
      }],
      opportunities: [{
        id: 'opportunity-a',
        title: '寻找合作伙伴',
        status: 'PUBLISHED',
        updatedAt: '2026-08-21T00:00:00.000Z',
      }],
      registrations: [{
        id: 'registration-a',
        eventId: 'event-a',
        title: '城市聚会',
        status: 'ATTENDED',
        createdAt: '2026-08-15T00:00:00.000Z',
      }],
      orders: [{
        id: 'order-a',
        orderType: 'MEMBERSHIP',
        title: '年度会员',
        status: 'PAID',
        amountCents: 79900,
        currency: 'CNY',
        merchantOrderNoMasked: 'MIP-…0001',
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    },
    ...overrides,
  }
}

describe('MIP admin user record contract', () => {
  it('accepts only the neutral user list request fields and rejects hidden identity input', () => {
    expect(createAdminUserListRequest({
      includePhone: false,
      filters: {
        query: '林',
        kind: 'PLAYER',
        status: 'ACTIVE',
        branchId: 'branch-a',
        levelId: 'level-a',
        experienceMin: '10',
        experienceMax: 200,
        joinedWithinDays: 30,
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-31T23:59:59.999Z',
      },
      limit: 25,
    })).toEqual({
      includePhone: false,
      filters: {
        query: '林',
        kind: 'PLAYER',
        status: 'ACTIVE',
        branchId: 'branch-a',
        levelId: 'level-a',
        experienceMin: '10',
        experienceMax: 200,
        joinedWithinDays: 30,
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-31T23:59:59.999Z',
      },
      limit: 25,
    })

    for (const input of [
      { appId: 'untrusted-app' },
      { filters: { openId: 'private-openid' } },
      { filters: { experienceMin: 201, experienceMax: 200 } },
      { filters: { createdFrom: '2026-09-01', createdTo: '2026-08-01' } },
      { cursor: 'not valid cursor!' },
      { limit: 51 },
    ]) {
      expect(() => createAdminUserListRequest(input)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    }
  })

  it('parses only exact user pages and rejects duplicate, private, or incoherent fields', () => {
    const value = { items: [user()], nextCursor: null }
    expect(parseAdminUserPage(value)).toEqual(value)

    const historicalPlayer = user({
      playerNumber: null,
      firstPlayerAt: '2026-01-01T00:00:00.000Z',
      latestEntitlementEndsAt: '2027-01-01T00:00:00.000Z',
      totalValidMembershipSeconds: 31_536_000,
    })
    expect(parseAdminUserPage({ items: [historicalPlayer], nextCursor: null }))
      .toEqual({ items: [historicalPlayer], nextCursor: null })

    const contactVisibility = user({
      visibility: {
        realName: true,
        gender: false,
        careerIdentity: true,
        influence: true,
        cardContacts: { phone: true, wechat: false, email: true, address: false },
      },
    })
    expect(parseAdminUserPage({ items: [contactVisibility], nextCursor: null }))
      .toEqual({ items: [contactVisibility], nextCursor: null })

    for (const item of [
      { ...user(), openId: 'private-openid' },
      user({ visibility: { influence: true, privateFact: true } as never }),
      user({ visibility: { cardContacts: { phone: true } } as never }),
      user({ phoneNumber: '18800000000' }),
      user({ phoneBound: false, phoneNumber: '18800000000' }),
      user({ levelId: null, levelName: '一级' }),
      user({ experience: 1.5 }),
    ]) {
      expect(() => parseAdminUserPage({ items: [item], nextCursor: null }))
        .toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    }
    expect(() => parseAdminUserPage({ items: [user(), user()], nextCursor: null }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(parseAdminUserPage({
      items: [user({ phoneNumber: '18800000000' })],
      nextCursor: null,
    }, true).items[0].phoneNumber).toBe('18800000000')
  })

  it('keeps membership, growth, branch, and influence facts mutually consistent', () => {
    const value = detail({
      playerNumber: 12,
      firstPlayerAt: '2026-01-01T00:00:00.000Z',
      latestEntitlementEndsAt: '2027-01-01T00:00:00.000Z',
      totalValidMembershipSeconds: 31_536_000,
    })
    expect(parseAdminUserDetail(value)).toEqual(value)

    const neverPlayer = detail({
      kind: 'GUEST',
      membership: null,
      playerNumber: null,
      firstPlayerAt: null,
      latestEntitlementEndsAt: null,
      totalValidMembershipSeconds: 0,
    })
    expect(parseAdminUserDetail(neverPlayer)).toEqual(neverPlayer)

    const scheduled = detail({
      kind: 'GUEST',
      membership: {
        status: 'ACTIVE',
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2031-01-01T00:00:00.000Z',
        isCurrent: false,
        isScheduled: true,
      },
    })
    expect(parseAdminUserDetail(scheduled)).toEqual(scheduled)

    for (const invalid of [
      detail({ kind: 'GUEST' }),
      detail({
        membership: {
          status: 'ACTIVE',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2027-01-01T00:00:00.000Z',
          isCurrent: true,
          isScheduled: true,
        },
      }),
      detail({ growth: { levelName: '一级', experience: 121, contribution: 30, coin: 8 } }),
      detail({ influence: { guestCount: -1, interactionCount: 5, interestCount: 7, visitorCount: 11 } }),
      { ...detail(), phoneNumber: '18800000000', phoneCiphertext: 'private' },
    ]) {
      expect(() => parseAdminUserDetail(invalid))
        .toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    }
  })

  it('wires list and detail through the strict contract before exposing data to pages', async () => {
    const requests: unknown[] = []
    const responses = [{ items: [user()], nextCursor: null }, detail()]
    const transport: AdminTransport = {
      async request(request) {
        requests.push(request)
        return responses.shift() as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await expect(gateway.listUsers({ filters: { kind: 'PLAYER' } }))
      .resolves
      .toEqual({ items: [user()], nextCursor: null })
    await expect(gateway.getUser('user-a')).resolves.toEqual(detail())
    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.users.list',
        input: { filters: { kind: 'PLAYER' } },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.users.get',
        input: { userId: 'user-a', includePhone: false },
      },
    ])

    const drift = createMipAdminGateway({
      request: vi.fn(async () => ({ ...detail(), influence: undefined })),
    })
    await expect(drift.getUser('user-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
