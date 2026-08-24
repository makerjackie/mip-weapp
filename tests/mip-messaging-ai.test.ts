import type { UserId } from '../src/modules/mip'
import type { AiDraft } from '../src/modules/mip-ai'
import type { MipMessagingGateway, WechatSubscriptionRequester } from '../src/modules/mip-messaging'
import { describe, expect, it, vi } from 'vitest'
import { assertAiDraftTransition, confirmAiDraft, normalizeStructuredDraft, requireAiEditorDraft, shouldExpireAiDraft } from '../src/modules/mip-ai'
import { buildInboxTarget, createMipMessagingModule, createWechatSubscriptionRequester, decideExternalDelivery, isTrustedInboxRoute, normalizeInboxIntent } from '../src/modules/mip-messaging'

describe('MIP messaging', () => {
  it('builds routes only from trusted target types', () => {
    expect(normalizeInboxIntent({
      recipientUserId: 'user-1' as UserId,
      messageType: 'OPPORTUNITY',
      title: '收到新的引荐',
      body: '一位用户提交了引荐意向。',
      targetType: 'OPPORTUNITY',
      targetId: 'opportunity-1',
      dedupeKey: 'referral:opportunity-1:user-2',
    }).target?.route).toBe('/packages/member/mip-opportunities/detail/index?id=opportunity-1')
    expect(() => normalizeInboxIntent({
      recipientUserId: 'user-1' as UserId,
      messageType: 'OPERATIONS',
      title: '通知',
      body: '内容',
      targetType: 'EXTERNAL_URL',
      targetId: 'https://example.com',
      dedupeKey: 'unsafe-route',
    })).toThrow('INBOX_TARGET_INVALID')
    expect(isTrustedInboxRoute('/packages/member/mip-opportunities/detail/index?id=opportunity-1')).toBe(true)
    expect(isTrustedInboxRoute('/pages/index/index?next=https://example.com')).toBe(false)
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    expect(buildInboxTarget('PROFILE', profileRef).route)
      .toBe(`/packages/member/mip-public-profile/index?profileRef=${profileRef}`)
    expect(isTrustedInboxRoute(`/packages/member/mip-public-profile/index?profileRef=${profileRef}`)).toBe(true)
    expect(isTrustedInboxRoute('/packages/member/mip-public-profile/index?profileRef=10000000-0000-4000-8000-000000000001')).toBe(false)
    expect(() => buildInboxTarget('PROFILE', '10000000-0000-4000-8000-000000000001'))
      .toThrow('INBOX_TARGET_INVALID')
  })

  it('keeps inbox authoritative when external delivery is unavailable', () => {
    expect(decideExternalDelivery({
      channel: 'WECHAT_SUBSCRIPTION',
      enabled: true,
      templateKey: 'event-reminder',
      grants: [],
    })).toEqual({
      channel: 'WECHAT_SUBSCRIPTION',
      deliver: false,
      reason: 'GRANT_UNAVAILABLE',
    })
  })

  it('maps a real WeChat template result to a logical grant decision', async () => {
    const requester = createWechatSubscriptionRequester(JSON.stringify({
      EVENT_REMINDER: { templateId: 'template-id' },
    }), async () => ({ 'template-id': 'accept' }) as never)
    expect(requester.capability('EVENT_REMINDER').available).toBe(true)
    await expect(requester.request('EVENT_REMINDER')).resolves.toBe('ACCEPTED')
  })

  it('caches the global unread count briefly and updates it after reading', async () => {
    const messageId = 'message-1' as never
    const listInbox = vi.fn(async () => ({
      items: [{
        id: messageId,
        recipientUserId: 'user-1' as UserId,
        messageType: 'EVENT' as const,
        title: '活动提醒',
        body: '活动即将开始。',
        createdAt: '2026-08-24T00:00:00.000Z',
      }],
      unreadCount: 1,
    }))
    const gateway: MipMessagingGateway = {
      listInbox,
      markRead: async id => ({ messageId: id, readAt: '2026-08-24T01:00:00.000Z' }),
      recordSubscriptionDecision: async (templateKey, decision) => ({
        templateKey,
        decision,
        grantAvailable: decision === 'ACCEPTED',
      }),
    }
    const requester: WechatSubscriptionRequester = {
      capability: templateKey => ({ templateKey, available: false }),
      request: async () => 'REJECTED',
    }
    const module = createMipMessagingModule(gateway, requester)

    await expect(module.refreshUnreadCount()).resolves.toBe(1)
    await expect(module.refreshUnreadCount()).resolves.toBe(1)
    expect(listInbox).toHaveBeenCalledTimes(1)
    await module.markRead(messageId)
    expect(module.peekUnreadCount()).toBe(0)
    await expect(module.refreshUnreadCount({ force: true })).resolves.toBe(1)
    expect(listInbox).toHaveBeenCalledTimes(2)
  })
})

describe('MIP AI drafts', () => {
  const draft: AiDraft = {
    id: 'draft-1' as never,
    userId: 'user-1' as UserId,
    purpose: 'COOPERATION_CARD',
    status: 'DRAFT_READY',
    structuredDraft: { roleKey: 'connector' },
    expiresAt: '2026-08-25T00:00:00.000Z',
    version: 4,
  }

  it('requires user confirmation of an editable draft', () => {
    expect(confirmAiDraft(draft, {
      draftId: draft.id,
      expectedVersion: 4,
      editedDraft: { roleKey: 'connector', target: '引荐三个合作方' },
    }, new Date('2026-08-24T00:00:00.000Z'))).toMatchObject({
      nextStatus: 'CONFIRMED',
      nextVersion: 5,
    })
  })

  it('does not allow AI to skip the draft-ready state', () => {
    expect(() => assertAiDraftTransition('STRUCTURING', 'CONFIRMED'))
      .toThrow('AI_DRAFT_TRANSITION_NOT_ALLOWED')
    expect(shouldExpireAiDraft(draft, new Date('2026-08-26T00:00:00.000Z'))).toBe(true)
  })

  it('drops fields outside the selected draft purpose', () => {
    expect(normalizeStructuredDraft('PROFILE', {
      headline: '产品负责人',
      adminRole: 'PLATFORM_OWNER',
    })).toEqual({ headline: '产品负责人' })
  })

  it('hydrates only a ready unexpired draft into its matching editor', () => {
    const editor = requireAiEditorDraft({
      ...draft,
      id: '20000000-0000-4000-8000-000000000001' as never,
    }, 'COOPERATION_CARD', Date.parse('2026-08-24T00:00:00.000Z'))
    expect(editor.confirmation).toEqual({ draftId: editor.draft.id, expectedVersion: 4 })
    expect(() => requireAiEditorDraft(draft, 'PROFILE', Date.parse('2026-08-24T00:00:00.000Z')))
      .toThrow('AI 草稿已过期或不适用于当前编辑器')
  })
})
