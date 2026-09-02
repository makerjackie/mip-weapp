import type {
  InboxMessageId,
  MipMessagingAction,
  MipMessagingGateway,
  MipMessagingRequest,
  WechatSubscriptionRequester,
} from '../src/modules/mip-messaging'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipMessagingCloudbaseTransport } from '../src/modules/mip-messaging/cloudbase-gateway'
import { createMipMessagingGateway } from '../src/modules/mip-messaging/gateway'
import { createMipMessagingModule } from '../src/modules/mip-messaging/module'
import { isRetryableMessagingAction } from '../src/modules/mip-messaging/retry-policy'
import { MipMessagingError } from '../src/modules/mip-messaging/types'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
}))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => ({ callFunction: cloudHarness.callFunction })),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { notificationsFunctionName: 'mip-notifications-api' } },
}))

const messageId = '10000000-0000-4000-8000-000000000001' as InboxMessageId
const inbox = {
  items: [{
    id: messageId,
    recipientUserId: '20000000-0000-4000-8000-000000000001' as never,
    messageType: 'EVENT' as const,
    title: '活动提醒',
    body: '活动即将开始。',
    createdAt: '2026-08-25T00:00:00.000Z',
  }],
  nextCursor: 'next-cursor',
  unreadCount: 1,
}

function resultFor(action: MipMessagingAction) {
  if (action === 'listInbox') {
    return inbox
  }
  if (action === 'markRead') {
    return { messageId, readAt: '2026-08-25T01:00:00.000Z' }
  }
  if (action === 'recordCustomerServiceInteraction') {
    return {
      channel: 'WECHAT_CUSTOMER_SERVICE',
      availableUntil: '2026-08-27T00:00:00.000Z',
    }
  }
  return { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED', grantAvailable: true }
}

afterEach(() => {
  cloudHarness.callFunction.mockReset()
  vi.useRealTimers()
})

describe('MIP messaging v1 contract', () => {
  it('sends all four actions as direct business input', async () => {
    const calls: MipMessagingRequest[] = []
    const gateway = createMipMessagingGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: resultFor(request.action) }
      },
    })

    await gateway.listInbox('cursor-1', 12)
    await gateway.markRead(messageId)
    await gateway.recordCustomerServiceInteraction()
    await gateway.recordSubscriptionDecision('EVENT_REMINDER', 'ACCEPTED')

    expect(calls).toEqual([
      {
        contractVersion: 1,
        action: 'listInbox',
        input: { cursor: 'cursor-1', limit: 12 },
      },
      {
        contractVersion: 1,
        action: 'markRead',
        input: { messageId },
      },
      {
        contractVersion: 1,
        action: 'recordCustomerServiceInteraction',
        input: {},
      },
      {
        contractVersion: 1,
        action: 'recordSubscriptionDecision',
        input: { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED' },
      },
    ])
    expect(calls.some(call => Object.hasOwn(call.input, 'input'))).toBe(false)
  })

  it('preserves structured server errors', async () => {
    const gateway = createMipMessagingGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'FORBIDDEN', message: '当前没有权限执行此操作', retryable: false },
        }
      },
    })

    await expect(gateway.markRead(messageId)).rejects.toEqual(expect.objectContaining({
      name: 'MipMessagingError',
      code: 'FORBIDDEN',
      retryable: false,
    }))
  })

  it('limits cold-start retry to listInbox', () => {
    expect(isRetryableMessagingAction('listInbox')).toBe(true)
    expect(isRetryableMessagingAction('markRead')).toBe(false)
    expect(isRetryableMessagingAction('recordCustomerServiceInteraction')).toBe(false)
    expect(isRetryableMessagingAction('recordSubscriptionDecision')).toBe(false)
  })

  it('retries listInbox while every mutation remains single-shot', async () => {
    vi.useFakeTimers()
    const transport = createMipMessagingCloudbaseTransport('mip-notifications-api')
    cloudHarness.callFunction
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: inbox } })

    const read = transport.invoke({
      contractVersion: 1,
      action: 'listInbox',
      input: { cursor: 'cursor-1', limit: 12 },
    })
    await vi.runAllTimersAsync()
    await expect(read).resolves.toEqual({ ok: true, data: inbox })
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(2)
    expect(cloudHarness.callFunction).toHaveBeenLastCalledWith({
      name: 'mip-notifications-api',
      data: {
        contractVersion: 1,
        action: 'listInbox',
        input: { cursor: 'cursor-1', limit: 12 },
      },
    })

    const mutations = [
      { contractVersion: 1, action: 'markRead', input: { messageId } },
      { contractVersion: 1, action: 'recordCustomerServiceInteraction', input: {} },
      {
        contractVersion: 1,
        action: 'recordSubscriptionDecision',
        input: { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED' },
      },
    ] satisfies MipMessagingRequest[]
    for (const request of mutations) {
      cloudHarness.callFunction.mockReset()
      cloudHarness.callFunction.mockRejectedValue(new Error('transport unavailable'))
      await expect(transport.invoke(request)).rejects.toEqual(expect.objectContaining({
        name: 'MipMessagingError',
        code: 'SERVICE_UNAVAILABLE',
      }))
      expect(cloudHarness.callFunction).toHaveBeenCalledTimes(1)
      expect(cloudHarness.callFunction).toHaveBeenCalledWith({
        name: 'mip-notifications-api',
        data: request,
      })
    }
  })

  it('keeps pagination and the first-page cache stable across failed mutations', async () => {
    const markRead = vi.fn(async (_messageId: InboxMessageId) => ({
      messageId,
      readAt: '2026-08-25T01:00:00.000Z',
    }))
    markRead.mockRejectedValueOnce(new MipMessagingError('SERVICE_UNAVAILABLE', '暂时不可用', true))
    const listInbox = vi.fn(async (cursor?: string) => cursor
      ? { items: [], unreadCount: 1 }
      : inbox)
    const gateway = {
      listInbox,
      markRead,
      recordCustomerServiceInteraction: vi.fn(),
      recordSubscriptionDecision: vi.fn(),
    } satisfies MipMessagingGateway
    const requester = {
      capability: templateKey => ({ templateKey, available: true }),
      request: vi.fn(async () => 'ACCEPTED' as const),
    } satisfies WechatSubscriptionRequester
    const module = createMipMessagingModule(gateway, requester)

    await module.listInbox()
    await module.listInbox('next-cursor')
    expect(module.peekInbox()).toEqual(inbox)
    await expect(module.markRead(messageId)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(module.peekInbox()).toEqual(inbox)
    await module.markRead(messageId)
    expect(module.peekInbox()).toMatchObject({
      unreadCount: 0,
      items: [{ id: messageId, readAt: '2026-08-25T01:00:00.000Z' }],
    })
  })

  it('does not add logging or client persistence for subscription decisions', () => {
    const sources = [
      'src/modules/mip-messaging/gateway.ts',
      'src/modules/mip-messaging/cloudbase-gateway.ts',
      'src/modules/mip-messaging/module.ts',
      'src/modules/mip-messaging/retry-policy.ts',
    ].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).join('\n')

    expect(sources).not.toMatch(/console\.|setStorage|getStorage|removeStorage/)
    expect(sources).not.toMatch(/JSON\.stringify\([^)]*(?:decision|templateKey)/i)
  })
})
