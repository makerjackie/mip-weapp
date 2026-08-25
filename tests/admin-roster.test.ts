import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function gateway() {
  return {
    getSession: vi.fn(),
    getDashboard: vi.fn(),
    listUsers: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateUser: vi.fn(),
    setUserControl: vi.fn(),
    createExport: vi.fn(),
    listEvents: vi.fn(),
    getEvent: vi.fn(),
    saveEvent: vi.fn(),
    cloneEvent: vi.fn(),
    changeEventStatus: vi.fn(),
    listRoster: vi.fn(async () => ({ items: [], nextCursor: null })),
    reviewRegistration: vi.fn(),
    checkIn: vi.fn(),
    listRoles: vi.fn(),
    searchRoleCandidates: vi.fn(),
    setRole: vi.fn(),
    listOpportunities: vi.fn(),
    unpublishOpportunity: vi.fn(),
    archiveOpportunity: vi.fn(),
    listGrowthLevels: vi.fn(),
    saveGrowthLevel: vi.fn(),
    listGrowthRules: vi.fn(),
    saveGrowthRule: vi.fn(),
    listGrowthEntries: vi.fn(),
    adjustGrowth: vi.fn(),
    listOrders: vi.fn(),
    submitRefund: vi.fn(),
    retryRefund: vi.fn(),
    listOperationalExceptions: vi.fn(),
    listAudit: vi.fn(),
  } satisfies MipAdminGateway
}

describe('MIP admin roster contract', () => {
  it('does not cache original phone responses', async () => {
    const source = gateway()
    const module = createMipAdminModule(source)

    await module.listRoster({ eventId: 'event-a', includePhone: true })
    await module.listRoster({ eventId: 'event-a', includePhone: true })
    await module.listUsers({ includePhone: true })
    await module.listUsers({ includePhone: true })

    expect(source.listRoster).toHaveBeenCalledTimes(2)
    expect(source.listUsers).toHaveBeenCalledTimes(2)
  })

  it('exposes only binding state until an audited phone request', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')
    const rosterType = types.slice(
      types.indexOf('export interface AdminRosterItem'),
      types.indexOf('export interface AdminRoleItem'),
    )

    expect(rosterType).toContain('phoneBound: boolean')
    expect(rosterType).toContain('phoneNumber: string | null')
    expect(rosterType).not.toContain('phoneMasked')
    expect(service).toContain('action: \'admin.events.roster.phone.view\'')
    expect(service).toContain('const { phoneCiphertext, userId, ...safe } = item')
  })

  it('prevents stale responses and clears original phone data on page exit', () => {
    const client = read('src/modules/mip-admin/client.ts')
    const pageTs = read('src/packages/admin/event-registrations/index.ts')
    const pageWxml = read('src/packages/admin/event-registrations/index.wxml')

    expect(pageTs).toContain('requestSeq')
    expect(pageTs).toContain('seq !== this.requestSeq')
    expect(pageTs).toContain('confirmationBusy = true')
    expect(pageTs).toMatch(/confirmationBusy = true[\s\S]*?wx\.showModal/)
    expect(pageTs).toContain('onHide()')
    expect(pageTs).toContain('phoneNumber: null')
    expect(pageTs).toContain('mipAdminModule.clearSensitive()')
    expect(client).toContain('input.includePhone === true')
    expect(pageWxml).toContain('手机已绑定')
    expect(pageWxml).toContain('item.phoneNumber || \'未绑定\'')
    expect(pageWxml).not.toContain('phoneMasked')
    expect(pageWxml).toContain('创建导出')
  })

  it('exposes registration review only through its scoped capability and versioned gateway action', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')
    const pageTs = read('src/packages/admin/event-registrations/index.ts')
    const pageWxml = read('src/packages/admin/event-registrations/index.wxml')

    expect(types).toContain('\'events.registrations.manage\'')
    expect(gateway).toContain('call(\'mip.admin.events.registrations.review\', input)')
    expect(pageTs).toContain('hasScopedCapability(session.capabilities, \'events.registrations.manage\', scope)')
    expect(pageTs).toContain('expectedVersion: version')
    expect(pageTs).toContain('decision,')
    expect(pageTs).toMatch(/confirmationBusy = true[\s\S]*?wx\.showModal/)
    expect(pageWxml).toContain('canReview && item.status === \'PENDING_REVIEW\'')
    expect(pageWxml).toContain('data-decision="APPROVE"')
    expect(pageWxml).toContain('data-decision="REJECT"')
  })

  it('keeps check-in undo behind a separate manager capability and a required reason', () => {
    const capabilities = read('cloudfunctions/mip-admin-api/domain/capabilities.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')
    const pageTs = read('src/packages/admin/event-registrations/index.ts')
    const pageWxml = read('src/packages/admin/event-registrations/index.wxml')

    expect(capabilities).toContain('EVENTS_CHECKIN_UNDO: \'events.checkin.undo\'')
    expect(gateway).toContain('call(\'mip.admin.events.undoCheckIn\', input)')
    expect(pageTs).toContain('hasScopedCapability(session.capabilities, \'events.checkin.undo\', scope)')
    expect(pageTs).toContain('placeholderText: \'撤销原因\'')
    expect(pageTs).toContain('reason,')
    expect(pageWxml).toContain('canUndoCheckIn && item.status === \'ATTENDED\'')
    expect(pageWxml).toContain('撤销签到')
  })
})
