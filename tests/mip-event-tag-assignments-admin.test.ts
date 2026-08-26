import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'
import {
  createAdminEventTagAssignmentsReplaceRequest,
  parseAdminEventTagAssignmentReplaceResult,
  parseAdminEventTagAssignments,
} from '../src/modules/mip-admin/event-tag-assignments'
import { MipAdminError } from '../src/modules/mip-admin/types'

vi.mock('../src/modules/platform/cloudbase', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const TAG_ID = '22222222-2222-4222-8222-222222222222'

const assignments = {
  eventId: EVENT_ID,
  eventVersion: 4,
  tags: [{
    id: TAG_ID,
    key: 'networking',
    name: '商务交流',
    description: '交流类活动',
    sortOrder: 10,
    catalogStatus: 'ACTIVE' as const,
    selectable: true,
    selected: true,
    assignmentVersion: 2,
  }],
}

describe('MIP event tag assignment admin contract', () => {
  it('strictly parses the controlled option state and rejects internal or inconsistent fields', () => {
    expect(parseAdminEventTagAssignments(assignments)).toEqual(assignments)
    expect(parseAdminEventTagAssignmentReplaceResult({
      ...assignments,
      eventVersion: 5,
      idempotent: false,
    })).toEqual({ ...assignments, eventVersion: 5, idempotent: false })

    expect(() => parseAdminEventTagAssignments({
      ...assignments,
      actorUserId: 'private-user',
    })).toThrowError(MipAdminError)
    expect(() => parseAdminEventTagAssignments({
      ...assignments,
      tags: [{ ...assignments.tags[0], selectable: false }],
    })).toThrowError(MipAdminError)
    expect(() => parseAdminEventTagAssignments({
      ...assignments,
      tags: [{ ...assignments.tags[0], selected: false }],
    })).toThrowError(MipAdminError)
    expect(() => parseAdminEventTagAssignmentReplaceResult({
      ...assignments,
      idempotent: 'false',
    })).toThrowError(MipAdminError)
  })

  it('uses the neutral v1 envelope and validates unique UUID selections before transport', async () => {
    const requests: Array<Record<string, unknown>> = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request) as unknown as Record<string, unknown>)
        return request.action.endsWith('.replace')
          ? { ...assignments, eventVersion: 5, idempotent: false } as never
          : assignments as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.getEventTagAssignments(EVENT_ID)
    await gateway.replaceEventTagAssignments({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_ID],
    })

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.events.tags.get',
        input: { eventId: EVENT_ID },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.events.tags.replace',
        input: { eventId: EVENT_ID, expectedVersion: 4, tagIds: [TAG_ID] },
      },
    ])
    expect(readActions.has('mip.admin.events.tags.get')).toBe(true)
    expect(readActions.has('mip.admin.events.tags.replace')).toBe(false)

    expect(() => createAdminEventTagAssignmentsReplaceRequest({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_ID, TAG_ID],
    })).toThrowError(MipAdminError)
    await expect(gateway.replaceEventTagAssignments({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: ['raw-tag-key'],
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(requests).toHaveLength(2)
  })

  it('caches reads and invalidates event and assignment facts only after success', async () => {
    const failure = new MipAdminError('CONFLICT', '记录状态已变化')
    const spies = {
      getEventTagAssignments: vi.fn<MipAdminGateway['getEventTagAssignments']>(
        async () => assignments,
      ),
      replaceEventTagAssignments: vi.fn<MipAdminGateway['replaceEventTagAssignments']>(
        async () => ({ ...assignments, eventVersion: 5, idempotent: false }),
      ),
      listEventCatalogs: vi.fn<MipAdminGateway['listEventCatalogs']>(
        async () => ({ items: [], nextCursor: null }),
      ),
      getEvent: vi.fn<MipAdminGateway['getEvent']>(async () => ({ id: EVENT_ID }) as never),
      listEvents: vi.fn<MipAdminGateway['listEvents']>(async () => ({ items: [], nextCursor: null })),
    }
    const module = createMipAdminModule(spies as unknown as MipAdminGateway)

    await module.eventCatalogs.getTagAssignments(EVENT_ID)
    await module.eventCatalogs.listCatalogs({ kind: 'TAG' })
    await module.getEventTagAssignments(EVENT_ID)
    await module.events.get(EVENT_ID)
    await module.events.list()
    expect(spies.getEventTagAssignments).toHaveBeenCalledTimes(1)

    await module.eventCatalogs.replaceTagAssignments({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_ID],
    })
    await module.getEventTagAssignments(EVENT_ID)
    await module.eventCatalogs.listCatalogs({ kind: 'TAG' })
    await module.events.get(EVENT_ID)
    await module.events.list()
    expect(spies.getEventTagAssignments).toHaveBeenCalledTimes(2)
    expect(spies.listEventCatalogs).toHaveBeenCalledTimes(2)
    expect(spies.getEvent).toHaveBeenCalledTimes(2)
    expect(spies.listEvents).toHaveBeenCalledTimes(2)

    spies.replaceEventTagAssignments.mockRejectedValueOnce(failure)
    await expect(module.eventCatalogs.replaceTagAssignments({
      eventId: EVENT_ID,
      expectedVersion: 5,
      tagIds: [],
    })).rejects.toBe(failure)
    await module.getEventTagAssignments(EVENT_ID)
    await module.eventCatalogs.listCatalogs({ kind: 'TAG' })
    expect(spies.getEventTagAssignments).toHaveBeenCalledTimes(2)
    expect(spies.listEventCatalogs).toHaveBeenCalledTimes(2)
  })
})
