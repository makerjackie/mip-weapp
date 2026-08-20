import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AdminDtoError,
  parseAdminAttendanceResult,
  parseAdminRosterExportResult,
  parseAdminRosterItem,
  parseAdminRosterPage,
} from '../src/modules/admin/event-dto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function validRosterItem(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    nickname: '林野',
    avatarUrl: '',
    city: '上海',
    status: 'REGISTERED',
    ticketCodeMasked: 'TAB1****34EF',
    registeredAt: '2026-07-20T10:00:00.000Z',
    attendedAt: null,
    phoneBound: true,
    version: 1,
    ...overrides,
  }
}

describe('admin roster client contract', () => {
  it('parses minimized roster pages and rejects internal identity leakage', () => {
    const page = parseAdminRosterPage({
      event: {
        id: '11111111-1111-4111-8111-111111111111',
        title: '公开沙龙',
        startsAt: '2026-07-21T10:00:00.000Z',
        status: 'PUBLISHED',
        registrationCount: 2,
        attendedCount: 1,
        cancelledCount: 0,
        totalCount: 2,
      },
      items: [validRosterItem(), validRosterItem({ id: '33333333-3333-4333-8333-333333333333', status: 'ATTENDED', version: 2 })],
      nextCursor: 'cursor-1',
    })
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBe('cursor-1')
    expect(page.event.attendedCount).toBe(1)
    expect(page.items[0].phoneNumber).toBeNull()

    const ownerPage = parseAdminRosterPage({
      event: {
        id: '11111111-1111-4111-8111-111111111111',
        title: '公开沙龙',
        startsAt: '2026-07-21T10:00:00.000Z',
        status: 'PUBLISHED',
        registrationCount: 1,
        attendedCount: 0,
        cancelledCount: 0,
        totalCount: 1,
      },
      items: [validRosterItem({ phoneNumber: '13812345678' })],
      nextCursor: null,
      canViewSensitiveRoster: true,
    })
    expect(ownerPage.items[0].phoneNumber).toBe('13812345678')

    expect(() => parseAdminRosterPage({
      event: ownerPage.event,
      items: [validRosterItem({ phoneNumber: '13812345678' })],
      nextCursor: null,
      canViewSensitiveRoster: false,
    })).toThrow(AdminDtoError)

    expect(() => parseAdminRosterItem({
      ...validRosterItem(),
      openid: 'oXXXX',
    })).toThrow(AdminDtoError)

    expect(() => parseAdminRosterItem({
      ...validRosterItem(),
      userId: 'u1',
    })).toThrow(AdminDtoError)

    expect(() => parseAdminRosterItem({
      ...validRosterItem(),
      ticketCode: 'TSECRET',
    })).toThrow(AdminDtoError)

    expect(() => parseAdminRosterExportResult({
      downloadToken: 'a'.repeat(64),
      fileName: 'event-roster-20260721T100000Z.xlsx',
      rowCount: 1,
      expiresAt: '2026-07-21T10:00:00.000Z',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      objectKey: 'secret/path',
    })).toThrow(/不允许的导出路径/)
  })

  it('parses attendance and export DTOs', () => {
    expect(parseAdminAttendanceResult({
      id: '22222222-2222-4222-8222-222222222222',
      eventId: '11111111-1111-4111-8111-111111111111',
      status: 'ATTENDED',
      version: 3,
      attendedAt: '2026-07-21T12:00:00.000Z',
      idempotent: false,
    })).toMatchObject({ status: 'ATTENDED', version: 3 })

    expect(parseAdminRosterExportResult({
      downloadToken: 'b'.repeat(64),
      fileName: 'event-roster-20260721T121500Z.xlsx',
      rowCount: 12,
      expiresAt: '2026-07-21T12:15:00.000Z',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toMatchObject({ rowCount: 12 })
  })

  it('wires roster APIs, cache invalidation, and page anti-stale search behavior', () => {
    const types = read('src/modules/admin/types.ts')
    const gateway = read('src/modules/admin/cloudbase-gateway.ts')
    const client = read('src/modules/admin/client.ts')
    const pageTs = read('src/packages/admin/event-registrations/index.ts')
    const pageWxml = read('src/packages/admin/event-registrations/index.wxml')
    const appJson = JSON.parse(read('src/app.json'))
    const adminPackage = appJson.subPackages?.find((item: { root: string }) => item.root === 'packages/admin')
    const eventsPage = read('src/packages/admin/events/index.ts')
    const eventsWxml = read('src/packages/admin/events/index.wxml')
    const adminApi = read('cloudfunctions/membership-admin-api/index.js')
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
    const exportStorage = read('cloudfunctions/membership-admin-api/lib/export-storage.js')
    const ticketPage = read('src/packages/member/ticket/index.ts')
    const registrationsPage = read('src/packages/member/registrations/index.ts')

    expect(adminPackage?.pages || []).toContain('event-registrations/index')
    expect(types).toContain('listEventRegistrations')
    expect(types).toContain('checkInRegistration')
    expect(types).toContain('undoCheckIn')
    expect(types).toContain('createRosterExport')
    expect(types).toContain('ticketCodeMasked')
    expect(gateway).toContain('listEventRegistrations')
    expect(gateway).toContain('parseAdminRosterPage')
    expect(gateway).toContain('resolveCloudFileUrls')
    expect(client).toContain('invalidateRosterCaches')
    expect(client).toContain('cache.invalidate(\'roster\')')
    expect(client).toContain('checkInRegistration')
    expect(pageTs).toContain('requestSeq')
    expect(pageTs).toContain('seq !== this.requestSeq')
    expect(pageTs).toContain('setTimeout')
    expect(pageTs).toContain('patchLocalItem')
    expect(pageTs).toContain('adminModule.checkInRegistration')
    expect(pageTs).toContain('adminModule.undoCheckIn')
    expect(pageTs).toContain('createRosterExport')
    expect(pageTs).toContain('downloadRosterExport')
    expect(pageTs).toContain('confirmationBusy')
    expect(pageTs).toContain('canOverrideCheckIn')
    expect(pageTs).toContain('allowOverride: true')
    expect(pageTs).toContain('fileType: \'xlsx\'')
    expect(pageTs).toContain('presentationSignature')
    expect(pageTs).toContain('loadMoreSeq')
    expect(pageTs).toContain('loadingMoreSeq')
    expect(pageTs).not.toContain('phoneMasked')
    expect(pageWxml).toContain('签到')
    expect(pageWxml).toContain('撤销签到')
    expect(pageWxml).toContain('导出名单（含手机号）')
    expect(pageWxml).toContain('box-border')
    expect(pageWxml).toContain('max-w-full')
    expect(pageWxml).toContain('撤销原因类别')
    expect(pageWxml).toContain('手机已绑定')
    expect(pageWxml).toContain('联系电话 {{item.phoneNumber}}')
    expect(pageTs).toContain('文件包含报名者联系电话')
    expect(pageWxml).not.toContain('phoneMasked')
    expect(types).not.toContain('phoneMasked')
    expect(eventsPage).toContain('openRoster')
    expect(eventsWxml).toContain('报名名单')
    expect(adminApi).toContain('listEventRegistrations')
    expect(adminApi).toContain('checkInRegistration')
    expect(adminApi).toContain('createRosterExport')
    expect(workflows).toContain('async function listEventRegistrations')
    expect(workflows).toContain('async function checkInRegistration')
    expect(workflows).toContain('async function undoCheckIn')
    expect(workflows).toContain('async function createRosterExport')
    expect(workflows).toContain('EVENT_ROSTER_EXPORTED')
    expect(workflows).toContain('EXPORT_TOO_LARGE')
    expect(workflows).toContain('member_export_tickets')
    expect(exportStorage).toContain('EXPORT_STORAGE_NOT_CONFIGURED')
    expect(exportStorage).toContain('createMemoryExportStorage')
    expect(exportStorage).toContain('createCloudBaseExportStorage')
    expect(exportStorage).not.toMatch(/mode === 'memory'[\s\S]*createMemoryExportStorage\(\)/)
    expect(ticketPage).toContain('ticketCodeMasked')
    expect(ticketPage).toContain('已保留上次结果')
    expect(registrationsPage).toContain('已签到')
    expect(registrationsPage).toContain('主办方已取消')
  })
})
