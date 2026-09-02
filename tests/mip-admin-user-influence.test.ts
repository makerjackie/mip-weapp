import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type {
  AdminUserInfluenceFact,
  AdminUserInfluenceListInput,
  AdminUserInfluencePage,
} from '../src/modules/mip-admin/user-influence'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  createAdminUserInfluenceRequest,
  parseAdminUserInfluencePage,
} from '../src/modules/mip-admin/user-influence'

vi.mock('../src/platform/storage/cloud-media', () => ({
  resolveCloudFileUrls: vi.fn(),
}))

vi.mock('../src/modules/mip-admin/cloudbase-transport', () => ({
  cloudbaseAdminTransport: { request: vi.fn() },
}))

function fact(overrides: Partial<AdminUserInfluenceFact> = {}): AdminUserInfluenceFact {
  return {
    reference: `if1.${'a'.repeat(22)}`,
    kind: 'INVITATION',
    direction: 'OUTGOING',
    status: 'ATTENDED',
    occurredAt: '2026-08-25T08:30:00.000Z',
    eventTitle: '城市聚会',
    counterpartNickname: '林然',
    counterpartKind: 'PLAYER',
    counterpartState: 'AVAILABLE',
    sourceType: 'USER',
    ...overrides,
  }
}

function page(overrides: Partial<AdminUserInfluencePage> = {}): AdminUserInfluencePage {
  return {
    items: [fact()],
    nextCursor: null,
    unavailableFacts: [],
    ...overrides,
  }
}

describe('MIP admin user influence contract', () => {
  it('canonicalizes a strict exact-key request without accepting hidden or loose fields', () => {
    expect(createAdminUserInfluenceRequest({
      userId: 'user-a',
      kind: 'VISIT',
      occurredFrom: '2026-08-01T00:00:00.000Z',
    })).toEqual({
      userId: 'user-a',
      kind: 'VISIT',
      direction: 'ALL',
      occurredFrom: '2026-08-01T00:00:00.000Z',
      limit: 20,
    })

    const withPrivateField = {
      userId: 'user-a',
      kind: 'VISIT',
      openId: 'private-openid',
    } as unknown as AdminUserInfluenceListInput
    const symbolInput = { userId: 'user-a', kind: 'VISIT' } as Record<PropertyKey, unknown>
    symbolInput[Symbol('private')] = true
    for (const input of [
      withPrivateField,
      symbolInput as unknown as AdminUserInfluenceListInput,
      { userId: ' user-a ', kind: 'VISIT' },
      { userId: 'user-a', kind: 'VISIT', limit: 20.5 },
      { userId: 'user-a', kind: 'VISIT', occurredFrom: 'not-a-date' },
      {
        userId: 'user-a',
        kind: 'VISIT',
        occurredFrom: '2026-09-01T00:00:00.000Z',
        occurredTo: '2026-08-01T00:00:00.000Z',
      },
    ] as AdminUserInfluenceListInput[]) {
      expect(() => createAdminUserInfluenceRequest(input)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    }
  })

  it('parses only the exact public fact DTO and enforces fact-specific states', () => {
    const value = page({
      items: [
        fact(),
        fact({
          reference: `if1.${'b'.repeat(22)}`,
          kind: 'HEART',
          direction: 'OUTGOING',
          status: 'CANCELLED',
          eventTitle: '行业交流',
          counterpartNickname: null,
          counterpartKind: null,
          counterpartState: 'NOT_RETAINED',
          sourceType: null,
        }),
        fact({
          reference: `if1.${'c'.repeat(22)}`,
          kind: 'VISIT',
          direction: 'INCOMING',
          status: 'UNREAD',
          eventTitle: null,
          counterpartNickname: 'MIP 用户',
          counterpartKind: 'GUEST',
          counterpartState: 'REDACTED',
          sourceType: null,
        }),
      ],
      nextCursor: 'next-page',
      unavailableFacts: ['CANCELLED_INCOMING_HEART'],
    })

    expect(parseAdminUserInfluencePage(value)).toEqual(value)

    const invalidFacts = [
      { ...fact(), openId: 'private-openid' },
      { ...fact(), phoneNumber: '18800000000' },
      { ...fact(), profileRef: 'profile-private' },
      { ...fact(), counterpartState: 'AVAILABLE', counterpartNickname: null },
      { ...fact(), counterpartState: 'UNAVAILABLE', counterpartNickname: '私密用户' },
      fact({ kind: 'HEART', status: 'CANCELLED', direction: 'OUTGOING', sourceType: null }),
      fact({ kind: 'VISIT', status: 'UNREAD', eventTitle: '不应有活动', sourceType: null }),
    ]
    for (const item of invalidFacts) {
      expect(() => parseAdminUserInfluencePage(page({ items: [item] }) as unknown))
        .toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    }
    expect(() => parseAdminUserInfluencePage({
      ...page(),
      phoneNumber: '18800000000',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
  })

  it('sends the neutral canonical operation and rejects kind or direction response drift', async () => {
    const requests: unknown[] = []
    const response = page({
      items: [fact({ direction: 'INCOMING' })],
    })
    const transport: AdminTransport = {
      async request(request) {
        requests.push(request)
        return response as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await expect(gateway.listUserInfluence({
      userId: 'user-a',
      kind: 'INVITATION',
      direction: 'INCOMING',
      cursor: 'cursor-a',
      limit: 10,
    })).resolves.toEqual(response)
    expect(requests).toEqual([{
      contractVersion: 1,
      action: 'mip.admin.users.influence.list',
      input: {
        userId: 'user-a',
        kind: 'INVITATION',
        direction: 'INCOMING',
        cursor: 'cursor-a',
        limit: 10,
      },
    }])

    const kindDrift = createMipAdminGateway({
      request: vi.fn(async () => page({
        items: [fact({
          kind: 'VISIT',
          status: 'READ',
          eventTitle: null,
          sourceType: null,
        })],
      })),
    })
    await expect(kindDrift.listUserInfluence({ userId: 'user-a', kind: 'INVITATION' }))
      .rejects
      .toMatchObject({ code: 'INVALID_RESPONSE' })

    const directionDrift = createMipAdminGateway({
      request: vi.fn(async () => page({ items: [fact({ direction: 'OUTGOING' })] })),
    })
    await expect(directionDrift.listUserInfluence({
      userId: 'user-a',
      kind: 'INVITATION',
      direction: 'INCOMING',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })

    const unavailableDrift = createMipAdminGateway({
      request: vi.fn(async () => page({ items: [], unavailableFacts: ['CANCELLED_INCOMING_HEART'] })),
    })
    await expect(unavailableDrift.listUserInfluence({
      userId: 'user-a',
      kind: 'HEART',
      direction: 'OUTGOING',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
