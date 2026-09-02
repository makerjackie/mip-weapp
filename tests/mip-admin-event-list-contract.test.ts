import type { AdminEvent, AdminEventListInput } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const event: AdminEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '城市交流会',
  summary: '活动摘要',
  scopeType: 'BRANCH',
  branchId: '22222222-2222-4222-8222-222222222222',
  branchName: '广州分会',
  status: 'PUBLISHED',
  contentSafetyStatus: 'PASSED',
  startsAt: '2030-08-25T10:00:00.000Z',
  endsAt: '2030-08-25T12:00:00.000Z',
  cityName: '广州',
  eventTypeKey: 'workshop',
  accessType: 'PAID',
  priceCents: 2500,
  registrationPolicy: 'AUTO',
  albumEnabled: true,
  albumSubmissionPolicy: 'REVIEW',
  capacity: 50,
  registrationCount: 12,
  attendedCount: 3,
  version: 4,
}

const input: AdminEventListInput = {
  filters: {
    query: '交流',
    startsFrom: '2030-08-01T00:00:00.000Z',
    startsTo: '2030-08-31T23:59:59.999Z',
    cityOrBranch: '广州',
    eventTypeKey: 'workshop',
    accessType: 'PAID',
    priceMinCents: 1000,
    priceMaxCents: 3000,
  },
  sort: { field: 'startsAt', direction: 'ASC' },
  cursor: 'opaque-cursor',
  limit: 20,
}

describe('MIP admin event list neutral contract', () => {
  it('passes the typed query unchanged and accepts the exact event DTO', async () => {
    const request = vi.fn(async () => ({ items: [event], nextCursor: 'next-cursor' }))
    const gateway = createMipAdminGateway({ request })

    await expect(gateway.listEvents(input)).resolves.toEqual({
      items: [event],
      nextCursor: 'next-cursor',
    })
    expect(request).toHaveBeenCalledWith({
      contractVersion: 1,
      action: 'mip.admin.events.list',
      input,
    })
  })

  it.each([
    ['missing event type', (value: any) => { delete value.items[0].eventTypeKey }],
    ['missing price', (value: any) => { delete value.items[0].priceCents }],
    ['invalid access type', (value: any) => { value.items[0].accessType = 'UNKNOWN' }],
    ['unexpected internal field', (value: any) => { value.items[0].internalBranchId = 'hidden' }],
    ['invalid cursor shape', (value: any) => { value.nextCursor = 42 }],
  ])('rejects malformed list DTO: %s', async (_name, mutate) => {
    const value = structuredClone({ items: [event], nextCursor: null }) as any
    mutate(value)
    const gateway = createMipAdminGateway({ request: vi.fn(async () => value) })

    await expect(gateway.listEvents()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
