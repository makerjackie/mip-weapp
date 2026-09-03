import type { MipAdminGateway, MipAdminSession } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule, hasCapability, hasScopedCapability } from '../src/modules/mip-admin/client'

const session: MipAdminSession = {
  enabled: true,
  roles: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' }],
  capabilities: [
    { capability: 'users.read', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.read', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.roster.read', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.checkin.manage', scopeType: 'BRANCH', scopeId: 'branch-a' },
    { capability: 'events.checkin.undo', scopeType: 'BRANCH', scopeId: 'branch-a' },
  ],
}

function gateway() {
  return {
    getSession: vi.fn(async () => session),
    confirmWebLogin: vi.fn(),
    listEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    getEvent: vi.fn(async (eventId: string) => ({
      id: eventId,
      status: 'PUBLISHED',
      version: 1,
    })),
    listRoster: vi.fn(async () => ({ items: [], nextCursor: null })),
    checkIn: vi.fn(),
    undoCheckIn: vi.fn(),
  } satisfies MipAdminGateway
}

describe('MIP admin client module', () => {
  it('uses scoped server grants only for display decisions', () => {
    expect(hasCapability(session.capabilities, 'users.read')).toBe(true)
    expect(hasCapability(session.capabilities, 'refunds.submit')).toBe(false)
    expect(hasCapability(session.capabilities, 'branches.manage')).toBe(false)
    expect(hasScopedCapability(session.capabilities, 'events.checkin.manage', {
      scopeType: 'EVENT',
      scopeId: 'event-a',
      branchId: 'branch-a',
    })).toBe(true)
    expect(hasScopedCapability(session.capabilities, 'events.checkin.manage', {
      scopeType: 'EVENT',
      scopeId: 'event-b',
      branchId: 'branch-b',
    })).toBe(false)
    expect(hasScopedCapability(session.capabilities, 'events.checkin.undo', {
      scopeType: 'EVENT',
      scopeId: 'event-a',
      branchId: 'branch-a',
    })).toBe(true)
  })

  it('caches the session read and honors the force refresh', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)

    await module.session.get()
    await module.session.get()
    expect(source.getSession).toHaveBeenCalledTimes(1)

    await module.session.get(true)
    expect(source.getSession).toHaveBeenCalledTimes(2)
  })

  it('caches event reads and invalidates them after a check-in mutation', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)

    await module.events.list()
    await module.events.list()
    expect(source.listEvents).toHaveBeenCalledTimes(1)

    await module.events.get('event-a')
    await module.events.get('event-a')
    expect(source.getEvent).toHaveBeenCalledTimes(1)

    await module.events.checkIn({
      eventId: 'event-a',
      registrationId: 'registration-a',
      expectedVersion: 1,
      idempotencyKey: 'checkin-event-a-1',
    })

    await module.events.list()
    await module.events.get('event-a')
    expect(source.listEvents).toHaveBeenCalledTimes(2)
    expect(source.getEvent).toHaveBeenCalledTimes(2)
    expect(source.checkIn).toHaveBeenCalledTimes(1)
  })

  it('caches roster reads by event and bypasses the cache for phone requests', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)

    await module.events.listRoster({ eventId: 'event-a' })
    await module.events.listRoster({ eventId: 'event-a' })
    expect(source.listRoster).toHaveBeenCalledTimes(1)

    await module.events.listRoster({ eventId: 'event-a', includePhone: true })
    await module.events.listRoster({ eventId: 'event-a', includePhone: true })
    expect(source.listRoster).toHaveBeenCalledTimes(3)
  })

  it('does not expose the raw gateway or a generic mutation escape hatch', () => {
    const module = createMipAdminModule(gateway())
    expect(module).not.toHaveProperty('gateway')
    expect(module).not.toHaveProperty('mutate')
  })
})
