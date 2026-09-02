import type { AdminEventInsights } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'
import { parseAdminEventInsights } from '../src/modules/mip-admin/event-insights'
import { createMipEventsAdmin } from '../src/modules/mip-admin/events-admin'

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const eventId = '11111111-1111-4111-8111-111111111111'

function validInsights(): AdminEventInsights {
  return {
    eventId,
    calculatedAt: '2026-08-25T12:00:00.000Z',
    participation: {
      effectiveRegistrationCount: 4,
      checkedInCount: 3,
      checkInRateBasisPoints: 7_500,
      pendingReviewCount: 1,
      waitlistedCount: 2,
    },
    invitations: { attributedRegistrationCount: 2, distinctInviterCount: 1 },
    composition: { playerCount: 3, guestCount: 1 },
    hearts: { voterCount: 3, activeVoteCount: 2, mutualMatchCount: 1 },
    feedback: {
      access: 'GRANTED',
      submissionCount: 2,
      eligibleCheckInCount: 3,
      submissionRateBasisPoints: 6_667,
      ratedCount: 2,
      averageRating: 4.5,
    },
    financials: {
      access: 'GRANTED',
      currency: 'CNY',
      paidOrderCount: 2,
      grossAmountCents: 10_000,
      refundedAmountCents: 3_000,
      netAmountCents: 7_000,
    },
    traffic: {
      views: { availability: 'NOT_TRACKED', count: null },
      shares: { availability: 'NOT_TRACKED', count: null },
    },
  }
}

describe('MIP event insights client contract', () => {
  it('accepts the exact neutral DTO and routes it as a retriable query', async () => {
    const request = vi.fn(async () => validInsights())
    const gateway = createMipAdminGateway({ request })

    await expect(gateway.getEventInsights(eventId)).resolves.toEqual(validInsights())
    expect(request).toHaveBeenCalledWith({
      contractVersion: 1,
      action: 'mip.admin.events.insights.get',
      input: { eventId },
    })
    expect(readActions.has('mip.admin.events.insights.get')).toBe(true)
  })

  it('accepts exact restricted optional blocks without invented traffic facts', () => {
    const value = validInsights()
    value.feedback = { access: 'RESTRICTED' }
    value.financials = { access: 'RESTRICTED' }
    expect(parseAdminEventInsights(value)).toEqual(value)
  })

  it('rejects an otherwise valid insight response for another event', async () => {
    const otherEventId = '22222222-2222-4222-8222-222222222222'
    const request = vi.fn(async () => ({
      ...validInsights(),
      eventId: otherEventId,
    }))
    const gateway = createMipAdminGateway({ request })

    await expect(gateway.getEventInsights(eventId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it.each([
    ['extra root field', (value: any) => { value.internal = true }],
    ['checked-in exceeds effective registration', (value: any) => { value.participation.checkedInCount = 5 }],
    ['check-in rate is not derived', (value: any) => { value.participation.checkInRateBasisPoints = 7_499 }],
    ['composition does not partition effective registrations', (value: any) => { value.composition.guestCount = 2 }],
    ['distinct inviter exceeds attributed registrations', (value: any) => { value.invitations.distinctInviterCount = 3 }],
    ['attributed registrations exceed effective registrations', (value: any) => { value.invitations.attributedRegistrationCount = 5 }],
    ['active votes exceed historical voters', (value: any) => { value.hearts.activeVoteCount = 4 }],
    ['mutual matches are double counted', (value: any) => { value.hearts.mutualMatchCount = 2 }],
    ['feedback rate is not derived', (value: any) => { value.feedback.submissionRateBasisPoints = 6_666 }],
    ['rated feedback exceeds submissions', (value: any) => { value.feedback.ratedCount = 3 }],
    ['average rating is missing for rated feedback', (value: any) => { value.feedback.averageRating = null }],
    ['refund exceeds gross amount', (value: any) => { value.financials.refundedAmountCents = 10_001 }],
    ['net amount is not derived', (value: any) => { value.financials.netAmountCents = 6_999 }],
    ['traffic zero is fabricated', (value: any) => { value.traffic.views.count = 0 }],
    ['nested extra field is present', (value: any) => { value.hearts.hiddenUserIds = [] }],
  ])('rejects malformed insight DTO: %s', (_name, mutate) => {
    const value = structuredClone(validInsights()) as any
    mutate(value)
    expect(() => parseAdminEventInsights(value)).toThrowError(expect.objectContaining({
      code: 'INVALID_RESPONSE',
    }))
  })

  it('requires null rates for zero denominators and exact restricted shapes', () => {
    const zero = validInsights()
    zero.participation = {
      effectiveRegistrationCount: 0,
      checkedInCount: 0,
      checkInRateBasisPoints: null,
      pendingReviewCount: 0,
      waitlistedCount: 0,
    }
    zero.invitations = { attributedRegistrationCount: 0, distinctInviterCount: 0 }
    zero.composition = { playerCount: 0, guestCount: 0 }
    zero.feedback = {
      access: 'GRANTED',
      submissionCount: 0,
      eligibleCheckInCount: 0,
      submissionRateBasisPoints: null,
      ratedCount: 0,
      averageRating: null,
    }
    expect(parseAdminEventInsights(zero)).toEqual(zero)

    const wrongRate = structuredClone(zero) as any
    wrongRate.participation.checkInRateBasisPoints = 0
    expect(() => parseAdminEventInsights(wrongRate)).toThrow()
    const leakedRestricted = structuredClone(zero) as any
    leakedRestricted.feedback = { access: 'RESTRICTED', submissionCount: 0 }
    expect(() => parseAdminEventInsights(leakedRestricted)).toThrow()
  })

  it('keeps insights behind the event facade cache and invalidates participation changes', async () => {
    const values = new Map<string, unknown>()
    const cache = {
      async query<T>(key: string, loader: () => Promise<T>, options: { force?: boolean } = {}) {
        if (!options.force && values.has(key)) {
          return values.get(key) as T
        }
        const value = await loader()
        values.set(key, value)
        return value
      },
      invalidate(prefix = '') {
        for (const key of values.keys()) {
          if (!prefix || key.startsWith(prefix)) {
            values.delete(key)
          }
        }
      },
    }
    const gateway = {
      getEventInsights: vi.fn(async () => validInsights()),
      checkIn: vi.fn(async () => ({ id: 'registration-a', status: 'ATTENDED', version: 2, idempotent: false })),
    } as unknown as Parameters<typeof createMipEventsAdmin>[0]
    const events = createMipEventsAdmin(gateway, cache)

    await events.getInsights(eventId)
    await events.getInsights(eventId)
    expect(gateway.getEventInsights).toHaveBeenCalledTimes(1)
    await events.checkIn({ eventId, registrationId: 'registration-a', expectedVersion: 1 })
    await events.getInsights(eventId)
    expect(gateway.getEventInsights).toHaveBeenCalledTimes(2)
    await events.getInsights(eventId, true)
    expect(gateway.getEventInsights).toHaveBeenCalledTimes(3)
  })
})
