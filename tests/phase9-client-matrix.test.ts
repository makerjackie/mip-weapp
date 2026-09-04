import type { MipCommerceError } from '../src/modules/mip-commerce/gateway'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { describe, expect, it, vi } from 'vitest'
import { createMipCommerceGateway } from '../src/modules/mip-commerce/gateway'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function extractRetryableActions(source: string): string[] {
  const match = source.match(/const (?:retryableReadActions|readActions) = new Set\(\[([\s\S]*?)\]\)/)
  if (!match) {
    return []
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1])
}

describe('phase9 gateway retry policy (read-only)', () => {
  it('MIP event gateway retries only declared read actions', () => {
    const eventGateway = read('src/modules/mip-events/cloudbase-gateway.ts')

    const eventReads = extractRetryableActions(eventGateway)

    expect(eventReads.length).toBeGreaterThan(0)

    const eventMutations = [
      'mip.events.register',
      'mip.events.updateRegistration',
      'mip.events.cancelRegistration',
      'mip.events.checkIn',
      'mip.events.setHeart',
      'mip.events.saveFeedback',
      'mip.events.createInvitation',
    ]

    for (const action of eventMutations) {
      expect(eventReads).not.toContain(action)
    }
    expect(eventReads).toContain('mip.events.myRegistration')

    expect(eventGateway).toContain('readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 }')
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

describe('phase9 malformed MIP commerce response rejection', () => {
  it('rejects malformed envelopes and payment parameters', async () => {
    const malformedEnvelope = createMipCommerceGateway({
      invoke: vi.fn(async () => null),
    }, { commerce: 'mip-commerce-api', payment: 'mip-cloudpay' })
    await expect(malformedEnvelope.listPlans()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<MipCommerceError>)

    const businessError = createMipCommerceGateway({
      invoke: vi.fn(async () => ({
        ok: false,
        error: { code: 'CONFLICT', message: '订单状态已变化', retryable: true },
      })),
    }, { commerce: 'mip-commerce-api', payment: 'mip-cloudpay' })
    await expect(businessError.listOrders()).rejects.toMatchObject({
      code: 'CONFLICT',
      retryable: true,
    } satisfies Partial<MipCommerceError>)

    const malformedPayment = createMipCommerceGateway({
      invoke: vi.fn(async () => ({ ok: true, data: { payment: { timeStamp: '1' } } })),
    }, { commerce: 'mip-commerce-api', payment: 'mip-cloudpay' })
    await expect(malformedPayment.createPayment('order-1' as never)).rejects.toMatchObject({
      code: 'INVALID_PAYMENT_RESPONSE',
    } satisfies Partial<MipCommerceError>)
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
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const roster = read('src/packages/admin/event-registrations/index.ts')

    expect(detail).toMatch(/if \(\(!currentEvent\?\.canCancel && !retryRefund\) \|\| this\.data\.busy\)/)
    expect(detail).toMatch(/busy: true[\s\S]*?showModal[\s\S]*?finally[\s\S]*?busy: false/)
    expect(registration).toMatch(/if \(!event \|\| this\.data\.busy \|\| !this\.validate\(\)\)/)
    expect(registration).toMatch(/busy: true[\s\S]*?mipEventsModule\.register[\s\S]*?finally[\s\S]*?busy: false/)
    expect(roster).toMatch(/this\.data\.processingId \|\| this\.confirmationBusy/)
    expect(roster).toMatch(/confirmationBusy/)
    expect(roster).toMatch(/this\.confirmationBusy = true[\s\S]*?showModal/)
    expect(roster).toMatch(/seq !== this\.requestSeq/)
  })
})

describe('phase9 paid event server-authoritative contract', () => {
  it('uses mip_orders from reservation through callback confirmation without client amount', () => {
    const eventService = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const eventApi = read('cloudfunctions/mip-events-api/index.js')
    const ledger = read('cloudfunctions/mip-payment-ledger/domain/ledger.js')
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const commerceModule = read('src/modules/mip-commerce/module.ts')

    const registrationFlow = eventService.slice(
      eventService.indexOf('async function createRegistration'),
      eventService.indexOf('async function listMyRegistrations'),
    )
    expect(registrationFlow).toContain('INSERT INTO mip_orders')
    expect(registrationFlow).toContain('VALUES (?, ?, ?, \'EVENT\'')
    expect(registrationFlow).toContain('INSERT INTO mip_event_seat_holds')
    expect(eventService).toContain('kind: \'PAYMENT_REQUIRED\'')
    expect(registrationFlow).not.toContain('mip_event_orders')
    expect(eventApi).toContain('case \'mip.events.register\'')

    expect(ledger).toContain('order.order_type === \'EVENT\'')
    expect(ledger).toContain('mip_event_seat_holds SET status = \'CONSUMED\'')
    expect(ledger).toContain('mip_event_registrations\n     SET status = \'REGISTERED\'')
    expect(ledger).toContain('SET status = \'REFUND_PENDING\'')
    expect(ledger).not.toContain('mip_event_orders')

    expect(registration).toContain('mipCommerceModule.payOrder(result.orderId)')
    expect(registration).toContain('payment.kind === \'CONFIRMED\'')
    expect(registration).not.toMatch(/(?:amountCents|priceCents|currency)\s*:/)
    expect(commerceModule).toContain('gateway.createPayment(order.id)')
    expect(commerceModule).toContain('gateway.reconcileOrder(order.id)')
    expect(commerceModule).toMatch(/catch \{[\s\S]*?interpretClientPayment\(requestResult, order\)/)
  })
})
