import { describe, expect, it } from 'vitest'
import { parseOperationalExceptionPage } from '../src/modules/mip-admin/operational-exceptions'
import { MipAdminError } from '../src/modules/mip-admin/types'

const eventId = '22222222-2222-4222-8222-222222222222'

function page(target: unknown = null) {
  return {
    items: [{
      id: 'OUTBOX:11111111-1111-4111-8111-111111111111',
      source: 'OUTBOX',
      status: 'FAILED',
      title: '业务事件处理失败',
      summary: '一项业务事件未完成后续处理。',
      occurredAt: '2026-08-24T12:00:00.000Z',
      reasonCode: null,
      target,
    }],
    nextCursor: null,
    availableTypes: ['OUTBOX', 'REFUND', 'PAYMENT'],
  }
}

describe('MIP admin operational exceptions', () => {
  it('accepts only a sanitized response and allowlisted business target', () => {
    const parsed = parseOperationalExceptionPage(page({
      type: 'EVENT',
      id: eventId,
      route: `/packages/admin/event-console/index?eventId=${eventId}`,
    }))
    expect(parsed.items[0].target?.id).toBe(eventId)

    expect(() => parseOperationalExceptionPage({
      ...page(),
      openid: 'must-not-be-accepted',
    })).toThrow(MipAdminError)
  })
})
