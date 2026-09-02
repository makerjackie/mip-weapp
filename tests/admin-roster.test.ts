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

    await module.events.listRoster({ eventId: 'event-a', includePhone: true })
    await module.events.listRoster({ eventId: 'event-a', includePhone: true })
    await module.users.list({ includePhone: true })
    await module.users.list({ includePhone: true })

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

  it('prevents stale responses and requests only the masked onsite roster', () => {
    const usersAdmin = read('src/modules/mip-admin/users-admin.ts')
    const pageTs = read('src/packages/admin/event-registrations/index.ts')
    const pageWxml = read('src/packages/admin/event-registrations/index.wxml')

    expect(pageTs).toContain('requestSeq')
    expect(pageTs).toContain('seq !== this.requestSeq')
    expect(pageTs).toContain('confirmationBusy = true')
    expect(pageTs).toMatch(/confirmationBusy = true[\s\S]*?wx\.showModal/)
    expect(pageTs).toContain('onHide()')
    expect(pageTs).toContain('Omit<AdminRosterItem, \'phoneNumber\'>')
    expect(pageTs).toContain('includePhone: false')
    expect(usersAdmin).toContain('input.includePhone === true')
    expect(pageWxml).not.toContain('phoneNumber')
    expect(pageWxml).not.toContain('查看完整号码')
    expect(pageWxml).not.toMatch(/\{\{item\.phoneNumber[\s|}]/)
    expect(pageWxml).not.toContain('创建导出')
  })

  it('keeps registration review in the service contract without exposing it onsite', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(types).toContain('\'events.registrations.manage\'')
    expect(gateway).toContain('call(\'mip.admin.events.registrations.review\', input)')
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
