import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { describe, expect, it, vi } from 'vitest'
import {
  AdminDtoError,
  parseAdminAttendanceResult,
  parseAdminEventCancelResult,
  parseAdminEventItem,
  parseAdminEventList,
  parseAdminEventSaveResult,
  parseAdminRosterExportResult,
  parseAdminRosterPage,
} from '../src/modules/admin/event-dto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function extractRetryableActions(source: string): string[] {
  const match = source.match(/const retryableReadActions = new Set\(\[([\s\S]*?)\]\)/)
  if (!match) {
    return []
  }
  return [...match[1].matchAll(/'([a-z]+)'/gi)].map(item => item[1])
}

function extractHandlerKeys(source: string): string[] {
  // actions: { name: handler, ... } or handlers map in cloud function index
  const block = source.match(/const actions = \{([\s\S]*?)\n\}/)
    || source.match(/const handlers = \{([\s\S]*?)\n\}/)
  if (!block) {
    return []
  }
  return [...block[1].matchAll(/^\s*([a-z]+)\s*:/gim)].map(item => item[1])
}

describe('phase9 gateway retry policy (read-only)', () => {
  it('admin and membership gateways retry only declared read actions', () => {
    const adminGateway = read('src/modules/admin/cloudbase-gateway.ts')
    const memberGateway = read('src/modules/membership/cloudbase-gateway.ts')

    const adminReads = extractRetryableActions(adminGateway)
    const memberReads = extractRetryableActions(memberGateway)

    expect(adminReads.length).toBeGreaterThan(0)
    expect(memberReads.length).toBeGreaterThan(0)

    const adminMutations = [
      'saveEvent',
      'setEventStatus',
      'cancelEvent',
      'checkInRegistration',
      'undoCheckIn',
      'createRosterExport',
      'downloadRosterExport',
      'createRefund',
      'reviewProfile',
    ]
    const memberMutations = [
      'createCheckout',
      'createPayment',
      'registerEvent',
      'cancelRegistration',
      'updateProfile',
      'bindPhone',
    ]

    for (const action of adminMutations) {
      expect(adminReads).not.toContain(action)
    }
    for (const action of memberMutations) {
      expect(memberReads).not.toContain(action)
    }

    // Structural: mutation calls must pass attempts: 1, not COLD_START_READ_RETRY blindly.
    expect(adminGateway).toContain('retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }')
    expect(memberGateway).toContain('retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }')
    expect(COLD_START_READ_RETRY.attempts).toBeGreaterThan(1)
  })

  it('retryTransport retries transport failures but not after success', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ ok: true })
    await expect(retryTransport(operation, { attempts: 3, delaysMs: [0, 0] })).resolves.toEqual({ ok: true })
    expect(operation).toHaveBeenCalledTimes(2)

    const mutation = vi.fn(async () => {
      throw new Error('write failed')
    })
    await expect(retryTransport(mutation, { attempts: 1 })).rejects.toThrow('write failed')
    expect(mutation).toHaveBeenCalledTimes(1)
  })
})

describe('phase9 malformed DTO rejection', () => {
  it('rejects ok:true envelopes with missing/illegal business fields', () => {
    expect(() => parseAdminEventList(null)).toThrow(AdminDtoError)
    expect(() => parseAdminEventList({ items: [] })).toThrow(AdminDtoError)
    expect(() => parseAdminEventSaveResult({ id: 'not-uuid', version: 1 })).toThrow(AdminDtoError)
    expect(() => parseAdminEventCancelResult({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'CANCELLED',
      version: 1,
      cancelledAt: null,
      cancellationReason: 'x',
      // missing affectedCount
    })).toThrow(AdminDtoError)
    expect(() => parseAdminAttendanceResult({
      id: '22222222-2222-4222-8222-222222222222',
      eventId: '11111111-1111-4111-8111-111111111111',
      status: 'PAID',
      version: 1,
      attendedAt: null,
    })).toThrow(AdminDtoError)
    expect(() => parseAdminRosterPage({
      event: { id: 'x' },
      items: [],
      nextCursor: null,
    })).toThrow(AdminDtoError)
    expect(() => parseAdminRosterExportResult({
      downloadToken: 'short',
      fileName: 'a.csv',
      rowCount: 1,
      expiresAt: '2026-01-01T00:00:00.000Z',
      contentType: 'text/csv',
      objectKey: 'secret',
    })).toThrow(AdminDtoError)
    expect(() => parseAdminEventItem({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'x',
      description: '',
      startsAt: '2027-01-01T00:00:00.000Z',
      endsAt: '2027-01-01T02:00:00.000Z',
      registrationDeadline: null,
      venueName: '',
      address: '',
      location: '',
      capacity: 10,
      cancellationPolicy: '',
      coverAssetId: null,
      version: 1,
      memberFree: true,
      priceCents: 100,
      activityType: 'PUBLIC_FREE',
      status: 'DRAFT',
      cancelledAt: null,
      cancellationReason: null,
    })).toThrow(/EVENT_DATA_INTEGRITY|非法|不一致/)
  })
})

describe('phase9 page double-click / stale / error recovery behavior', () => {
  it('blocks concurrent check-in while processingId is set', async () => {
    const checkInRegistration = vi.fn(async () => ({
      id: 'reg-1',
      eventId: 'evt-1',
      status: 'ATTENDED' as const,
      version: 2,
      attendedAt: '2026-07-21T12:00:00.000Z',
      idempotent: false,
    }))

    const page: any = {
      data: {
        processingId: '',
        undoing: false,
        exporting: false,
        eventId: 'evt-1',
        items: [{
          id: 'reg-1',
          nickname: '林野',
          status: 'REGISTERED',
          version: 1,
          attendedAt: null,
        }],
        attendedCount: 0,
        registrationCount: 1,
        message: '',
      },
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch)
      },
      async checkIn(registrationId: string) {
        if (this.data.processingId || this.data.undoing || this.data.exporting) {
          return
        }
        const selected = this.data.items.find((item: { id: string }) => item.id === registrationId)
        if (!selected || selected.status !== 'REGISTERED') {
          return
        }
        this.setData({ processingId: registrationId, message: '' })
        try {
          const result = await checkInRegistration(this.data.eventId, registrationId, selected.version)
          this.setData({
            items: this.data.items.map((item: any) =>
              item.id === result.id
                ? { ...item, status: result.status, version: result.version, attendedAt: result.attendedAt }
                : item),
            message: result.idempotent ? 'idempotent' : 'ok',
          })
        }
        finally {
          this.setData({ processingId: '' })
        }
      },
    }

    const first = page.checkIn('reg-1')
    // Second click while first in-flight must no-op.
    await page.checkIn('reg-1')
    await first
    expect(checkInRegistration).toHaveBeenCalledTimes(1)
    expect(page.data.items[0].status).toBe('ATTENDED')
  })

  it('drops stale roster responses when a newer requestSeq wins', async () => {
    const page: any = {
      requestSeq: 0,
      data: {
        state: 'loading',
        items: [] as Array<{ id: string }>,
        message: '',
        processingId: '',
      },
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch)
      },
      async load(label: string, delayMs: number) {
        const seq = this.requestSeq + 1
        this.requestSeq = seq
        await new Promise(resolve => setTimeout(resolve, delayMs))
        if (seq !== this.requestSeq) {
          return
        }
        this.setData({ state: 'ready', items: [{ id: label }] })
      },
    }

    const slow = page.load('stale', 30)
    const fast = page.load('fresh', 5)
    await Promise.all([slow, fast])
    expect(page.data.items).toEqual([{ id: 'fresh' }])
    expect(page.data.state).toBe('ready')
  })

  it('keeps ready content on background refresh failure', async () => {
    const page: any = {
      data: {
        state: 'ready',
        items: [{ id: 'cached' }],
        message: '',
      },
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch)
      },
      async refresh(forceFail: boolean) {
        const cached = this.data.state === 'ready' ? this.data.items : null
        try {
          if (forceFail) {
            throw new Error('network')
          }
          this.setData({ state: 'ready', items: [{ id: 'new' }], message: '' })
        }
        catch {
          this.setData(cached
            ? { message: '名单更新失败，已保留上次结果。' }
            : { state: 'error', message: '名单加载失败' })
        }
      },
    }

    await page.refresh(true)
    expect(page.data.state).toBe('ready')
    expect(page.data.items).toEqual([{ id: 'cached' }])
    expect(page.data.message).toContain('保留')
  })

  it('event detail and registration confirm gate double submit via busy flag', () => {
    const detail = read('src/packages/member/event-detail/index.ts')
    const confirm = read('src/packages/member/registration-confirm/index.ts')
    const ticket = read('src/packages/member/ticket/index.ts')
    const adminEvents = read('src/packages/admin/events/index.ts')
    const roster = read('src/packages/admin/event-registrations/index.ts')

    // Behavioral gates present in source (not mere token presence of "busy").
    expect(detail).toMatch(/if \(this\.data\.busy \|\| \[/)
    expect(confirm).toMatch(/if \(!this\.data\.event \|\| this\.data\.busy\)/)
    expect(ticket).toMatch(/if \(!this\.data\.canCancel \|\| this\.data\.busy\)/)
    // Confirm latch must be set before showModal and released in finally.
    expect(ticket).toMatch(/this\.setData\(\{ busy: true[\s\S]*?showModal/)
    expect(adminEvents).toMatch(/if \(this\.data\.saving\)/)
    expect(adminEvents).toMatch(/if \(this\.data\.conflict\)/)
    expect(adminEvents).toMatch(/cancelConflict/)
    expect(adminEvents).toMatch(/this\.setData\(\{ processingId: eventId[\s\S]*?showModal/)
    expect(roster).toMatch(/if \(this\.data\.processingId \|\| this\.data\.undoing \|\| this\.data\.exporting \|\| this\.confirmationBusy\)/)
    expect(roster).toMatch(/confirmationBusy/)
    expect(roster).toMatch(/this\.confirmationBusy = true[\s\S]*?showModal/)
    expect(roster).toMatch(/seq !== this\.requestSeq/)
    expect(roster).toMatch(/loadMoreSeq/)
    expect(roster).toMatch(/loadingMoreSeq/)
  })
})

describe('phase9 paid event server-authoritative contract', () => {
  it('supports PAID through reservation, callback grant, and client payment without client amount', () => {
    const adminWorkflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
    const adminEventsWxml = read('src/packages/admin/events/index.wxml')
    const memberWorkflows = read('cloudfunctions/membership-api/lib/workflows.js')
    const memberApi = read('cloudfunctions/membership-api/index.js')
    const membershipModule = read('src/modules/membership/module.ts')

    expect(adminWorkflows).not.toContain('EVENT_PAYMENT_NOT_READY')
    expect(adminWorkflows).toContain('normalized.activityType')
    expect(memberWorkflows).toContain('createEventReservationOrder')
    expect(memberWorkflows).toContain('member_event_reservations')
    expect(memberWorkflows).toMatch(/EVENT_PAYMENT_REQUIRED/)
    expect(memberApi).toContain('kind: \'PAYMENT_REQUIRED\'')
    expect(adminEventsWxml).toContain('独立付费')
    expect(membershipModule).toContain('gateway.createPayment(result.orderId)')
    expect(membershipModule).not.toMatch(/registerEvent\([^)]*amountCents/)

    const adminApi = read('cloudfunctions/membership-admin-api/index.js')
    const keys = extractHandlerKeys(adminApi)
    expect(keys).toEqual(expect.arrayContaining([
      'listEventRegistrations',
      'checkInRegistration',
      'undoCheckIn',
      'createRosterExport',
      'cancelEvent',
    ]))
    expect(keys).not.toContain('createEventOrder')
    expect(keys).not.toContain('grantPaidRegistration')
  })
})
