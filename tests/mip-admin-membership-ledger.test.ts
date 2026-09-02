import { describe, expect, it } from 'vitest'
import {
  createAdminMembershipTimelineRequest,
  parseAdminMembershipTimelinePage,
} from '../src/modules/mip-admin/memberships'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function item(playerNumber: number | null) {
  return {
    id: id(1),
    user: { id: id(2), nickname: '测试用户', status: 'ACTIVE', playerNumber },
    sourceType: 'ORDER',
    status: 'ACTIVE',
    startsAt: '2030-01-01T00:00:00.000Z',
    endsAt: '2031-01-01T00:00:00.000Z',
    currentlyActive: true,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    order: {
      id: id(3),
      status: 'PAID',
      amountCents: 660000,
      currency: 'CNY',
      paidAt: '2030-01-01T00:00:00.000Z',
      refundStatus: null,
      refundedAmountCents: 0,
    },
    adjustment: null,
  }
}

describe('admin membership ledger operator contract', () => {
  it('searches by nickname or player number while retaining internal deep-link filtering', () => {
    expect(createAdminMembershipTimelineRequest({
      filters: { userId: id(2).toUpperCase(), userQuery: '  玩家 42  ' },
    })).toEqual({ filters: { userId: id(2), userQuery: '玩家 42' } })
    expect(() => createAdminMembershipTimelineRequest({ filters: { userQuery: 'a'.repeat(65) } }))
      .toThrow('Invalid admin membership timeline user query')
  })

  it('accepts player numbers without exposing raw user identifiers in the DTO', () => {
    expect(parseAdminMembershipTimelinePage({ items: [item(42), item(null)], nextCursor: null }))
      .toMatchObject({ items: [{ user: { playerNumber: 42 } }, { user: { playerNumber: null } }] })
  })
})
