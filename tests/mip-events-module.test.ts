import type { EventId } from '../src/modules/mip'
import type {
  EventFeedResult,
  MipEventDetail,
  MipEventsGateway,
} from '../src/modules/mip-events'
import { describe, expect, it, vi } from 'vitest'
import { createMipEventsModule } from '../src/modules/mip-events'

const eventId = 'event-1' as EventId

const event: MipEventDetail = {
  id: eventId,
  scopeType: 'PLATFORM',
  title: 'MIP 活动',
  summary: '活动摘要',
  description: '活动介绍',
  eventTypeLabel: '交流活动',
  mode: 'OFFLINE',
  accessType: 'PAID',
  startsAt: '2026-08-25T00:00:00.000Z',
  endsAt: '2026-08-25T02:00:00.000Z',
  status: 'PUBLISHED',
  registrationCount: 0,
  participantPreview: [],
  onlineAccessAvailable: false,
  registrationPolicy: 'AUTO',
  priceCents: 9900,
  currency: 'CNY',
  formVersion: 1,
  registrationSchema: [],
  changes: [],
  canRegister: true,
  canCancel: false,
  canCheckIn: false,
  canInteract: false,
  albumEnabled: true,
  albumSubmissionPolicy: 'REVIEW',
}

function createGateway() {
  const feed: EventFeedResult = { items: [event] }
  return {
    listEvents: vi.fn(async () => feed),
    getEvent: vi.fn(async () => event),
    listPublicParticipants: vi.fn(async () => ({ items: [] })),
    listEventAlbum: vi.fn(async () => ({
      eventId,
      albumEnabled: true,
      submissionPolicy: 'REVIEW' as const,
      items: [],
    })),
    listMyEventAlbumSubmissions: vi.fn(async () => ({
      eventId,
      albumEnabled: true,
      submissionPolicy: 'REVIEW' as const,
      canSubmit: true,
      items: [],
    })),
    submitEventAlbumPhoto: vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'PENDING' as const,
      version: 1,
      idempotent: false,
    })),
    withdrawEventAlbumPhoto: vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'WITHDRAWN' as const,
      version: 2,
    })),
    listMyRegistrations: vi.fn(async () => ({ items: [] })),
    getMyRegistration: vi.fn(async () => null),
    register: vi.fn(async input => ({
      kind: 'PAYMENT_REQUIRED' as const,
      registrationId: 'registration-1',
      status: 'PAYMENT_PENDING' as const,
      orderId: 'order-1' as never,
      amountCents: 9900,
      currency: 'CNY' as const,
      holdExpiresAt: '2026-08-24T00:15:00.000Z',
      paymentAvailable: false,
      input,
    })),
    updateRegistration: vi.fn(async input => ({
      status: 'PENDING_REVIEW' as const,
      version: input.expectedVersion + 1,
      formVersion: input.formVersion,
      answers: input.answers,
      shareProfile: input.shareProfile,
      canEdit: true,
    })),
    cancelRegistration: vi.fn(async () => ({
      registrationId: 'registration-1',
      status: 'CANCELLED' as const,
      refundRequired: false,
      paymentAvailable: false,
    })),
    checkIn: vi.fn(async () => ({ eventId, registrationId: 'registration-1', status: 'ATTENDED' as const, checkedInAt: '', idempotent: false })),
    resolveCheckInScene: vi.fn(async () => ({
      eventId,
      resumeToken: `${'a'.repeat(24)}.${'b'.repeat(43)}`,
      validFrom: '2026-08-25T03:00:00.000Z',
      validUntil: '2026-08-25T03:30:00.000Z',
    })),
    resolveInvitationScene: vi.fn(async () => ({ eventId, invitationToken: 'invitation-token', validUntil: '' })),
    createCheckInPoster: vi.fn(async (_eventId, mode = 'STATIC') => ({
      eventId,
      credentialId: 'credential-1',
      scanToken: 's1.abcdefghijk.lmnopqrstuv',
      mode,
      validFrom: '',
      validUntil: '',
      assetId: 'asset-1',
      codeUrl: 'https://example.test/code.png',
    })),
    createInvitationCode: vi.fn(async () => ({
      invitationId: 'invitation-1',
      eventId,
      scene: 'i1.abcdefghijk.lmnopqrstuv',
      validUntil: '',
      assetId: 'asset-1',
      codeUrl: 'https://example.test/invitation.png',
    })),
    listHeartCandidates: vi.fn(async () => []),
    listHeartHistory: vi.fn(async kind => ({ kind, items: [] })),
    getHeart: vi.fn(async () => ({ received: [], version: 0 })),
    setHeart: vi.fn(async () => ({ received: [], version: 1 })),
    getFeedback: vi.fn(async () => null),
    saveFeedback: vi.fn(async (_eventId, draft) => ({ id: 'feedback-1', ...draft, version: 1, submittedAt: '', updatedAt: '' })),
    listAdminFeedback: vi.fn(async () => ({ items: [], nextCursor: undefined })),
    createInvitation: vi.fn(async () => ({ token: 'invitation-token' })),
  } satisfies MipEventsGateway
}

describe('MIP events client module', () => {
  it('caches server-owned event feeds and supports a forced refresh', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    const query = { view: 'UPCOMING' as const, dateFilter: 'RECENT' as const }
    await module.listEvents(query)
    await module.listEvents(query)
    await module.listEvents(query, { force: true })
    expect(gateway.listEvents).toHaveBeenCalledTimes(2)
  })

  it('normalizes a selected calendar date and keeps cursor pagination in the server query', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      date: '2026-08-24',
      cursor: 'cursor-2',
      limit: 99,
    })
    expect(gateway.listEvents).toHaveBeenCalledWith({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      date: '2026-08-24',
      cursor: 'cursor-2',
      limit: 30,
    })

    await module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      date: '24/08/2026',
    })
    expect(gateway.listEvents).toHaveBeenLastCalledWith(expect.objectContaining({ date: undefined }))
  })

  it('normalizes public participant search and keeps role filtering on the server', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await module.listPublicParticipants(eventId, {
      keyword: '  设计顾问  ',
      userKind: 'PLAYER',
      cursor: 'cursor-1',
      limit: 99,
    })
    expect(gateway.listPublicParticipants).toHaveBeenCalledWith(eventId, {
      keyword: '设计顾问',
      userKind: 'PLAYER',
      cursor: 'cursor-1',
      limit: 30,
    })
    expect(() => module.listPublicParticipants(eventId, { userKind: 'ADMIN' as never }))
      .toThrow('参与人筛选参数无效')
  })

  it('does not retain an online access address in the presentation cache', async () => {
    const gateway = createGateway()
    gateway.getEvent.mockResolvedValue({
      ...event,
      mode: 'ONLINE',
      registrationStatus: 'REGISTERED',
      onlineAccessAvailable: true,
      onlineUrl: 'https://meeting.example.com/room',
    })
    const module = createMipEventsModule(gateway)
    await expect(module.getEvent(eventId)).resolves.toMatchObject({
      onlineAccessAvailable: true,
      onlineUrl: 'https://meeting.example.com/room',
    })
    expect(module.peekEvent(eventId)).toMatchObject({ onlineAccessAvailable: false })
    expect(module.peekEvent(eventId)?.onlineUrl).toBeUndefined()
    await module.getEvent(eventId)
    expect(gateway.getEvent).toHaveBeenCalledTimes(2)
  })

  it('submits answers and an idempotency key without a client amount', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    const result = await module.register({
      eventId,
      formVersion: 1,
      answers: { role: '参与者' },
      shareProfile: false,
    })
    expect(result).toMatchObject({ kind: 'PAYMENT_REQUIRED', status: 'PAYMENT_PENDING' })
    expect(gateway.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      formVersion: 1,
      answers: { role: '参与者' },
      shareProfile: false,
      idempotencyKey: expect.stringMatching(/^event-registration-/),
    }))
    expect(gateway.register.mock.calls[0][0]).not.toHaveProperty('amountCents')
  })

  it('submits a durable event-cancellation refund from the shared events module', async () => {
    const gateway = createGateway()
    gateway.cancelRegistration.mockResolvedValue({
      registrationId: 'registration-1',
      status: 'CANCELLATION_PENDING',
      refundRequired: true,
      refundId: 'refund-1',
      refundStatus: 'PENDING',
      paymentAvailable: true,
    })
    const submitRefund = vi.fn(async () => ({ status: 'PROVIDER_CREATED' }))
    const module = createMipEventsModule(gateway, { submitRefund })
    await expect(module.cancelRegistration(eventId, 3)).resolves.toMatchObject({
      status: 'CANCELLATION_PENDING',
      refundSubmission: 'SUBMITTED',
    })
    expect(submitRefund).toHaveBeenCalledWith('refund-1')
  })

  it('keeps a failed provider submission as a retryable server refund instead of failing cancellation', async () => {
    const gateway = createGateway()
    gateway.cancelRegistration.mockResolvedValue({
      registrationId: 'registration-1',
      status: 'CANCELLATION_PENDING',
      refundRequired: true,
      refundId: 'refund-1',
      refundStatus: 'PENDING',
      paymentAvailable: true,
    })
    const module = createMipEventsModule(gateway, {
      submitRefund: vi.fn(async () => { throw new Error('provider unavailable') }),
    })
    await expect(module.cancelRegistration(eventId)).resolves.toMatchObject({
      status: 'CANCELLATION_PENDING',
      refundId: 'refund-1',
      refundSubmission: 'PENDING_RETRY',
    })
  })

  it('reads and updates the current registration with an idempotency key and expected version', async () => {
    const gateway = createGateway()
    gateway.getMyRegistration.mockResolvedValue({
      status: 'PENDING_REVIEW',
      version: 4,
      formVersion: 1,
      answers: { role: '嘉宾' },
      shareProfile: false,
      canEdit: true,
    })
    const module = createMipEventsModule(gateway)
    await expect(module.getMyRegistration(eventId)).resolves.toMatchObject({ version: 4, canEdit: true })
    await expect(module.updateRegistration({
      eventId,
      formVersion: 2,
      expectedVersion: 4,
      answers: { role: '玩家' },
      shareProfile: true,
    })).resolves.toMatchObject({ version: 5, formVersion: 2 })
    expect(gateway.updateRegistration).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      formVersion: 2,
      expectedVersion: 4,
      idempotencyKey: expect.stringMatching(/^event-registration-update-/),
    }))
  })

  it('validates feedback locally while leaving attendance authorization to the server', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await expect(module.saveFeedback(eventId, { rating: 5, body: '  有收获  ' })).resolves.toMatchObject({ body: '有收获' })
    await expect(module.saveFeedback(eventId, { rating: 6, body: '内容' })).rejects.toThrow('请选择 1–5 分')
    expect(gateway.saveFeedback).toHaveBeenCalledTimes(1)
  })

  it('normalizes admin feedback filters and leaves authorization on the server', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await module.listAdminFeedback(eventId, { rating: 5, cursor: 'cursor-1', limit: 99 })
    expect(gateway.listAdminFeedback).toHaveBeenCalledWith(eventId, {
      rating: 5,
      cursor: 'cursor-1',
      limit: 30,
    })
    expect(() => module.listAdminFeedback(eventId, { rating: 6 as never }))
      .toThrow('评分筛选参数无效')
  })

  it('accepts only the bounded short scene used by unlimited mini-program codes', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    const scene = 's1.abcdefghijk.lmnopqrstuv'
    await expect(module.resolveCheckInScene(scene)).resolves.toMatchObject({ eventId, resumeToken: expect.any(String) })
    expect(() => module.resolveCheckInScene('event-id.secret')).toThrow('活动码无效')
  })

  it('accepts only bounded invitation scenes and creates invitation codes through the server', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    const scene = 'i1.abcdefghijk.lmnopqrstuv'
    await expect(module.resolveInvitationScene(scene)).resolves.toMatchObject({ eventId })
    await expect(module.createInvitationCode(eventId)).resolves.toMatchObject({ scene })
    expect(() => module.resolveInvitationScene('bad.scene')).toThrow('活动邀请无效')
  })

  it('forwards the selected check-in credential mode to the server gateway', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await expect(module.createCheckInPoster(eventId, 'ROTATING')).resolves.toMatchObject({ mode: 'ROTATING' })
    expect(gateway.createCheckInPoster).toHaveBeenCalledWith(eventId, 'ROTATING')
  })

  it('loads sent and received heart history with server pagination', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    await expect(module.listHeartHistory('SENT', 'cursor-1')).resolves.toMatchObject({ kind: 'SENT' })
    expect(gateway.listHeartHistory).toHaveBeenCalledWith('SENT', 'cursor-1', 20)
    expect(() => module.listHeartHistory('UNKNOWN' as never)).toThrow('心动记录类型无效')
  })

  it('submits and withdraws album photos without client-owned review facts', async () => {
    const gateway = createGateway()
    const module = createMipEventsModule(gateway)
    const assetId = '22222222-2222-4222-8222-222222222222'
    const photoId = '33333333-3333-4333-8333-333333333333'

    await expect(module.listEventAlbum(eventId)).resolves.toMatchObject({ albumEnabled: true })
    await expect(module.listMyEventAlbumSubmissions(eventId)).resolves.toMatchObject({ canSubmit: true })
    await expect(module.submitEventAlbumPhoto(eventId, assetId, '  活动照片  '))
      .resolves
      .toMatchObject({ status: 'PENDING' })
    await expect(module.withdrawEventAlbumPhoto(photoId, 3)).resolves.toMatchObject({ status: 'WITHDRAWN' })

    expect(gateway.submitEventAlbumPhoto).toHaveBeenCalledWith(eventId, assetId, '活动照片')
    expect(gateway.submitEventAlbumPhoto.mock.calls[0][2]).not.toMatch(/PUBLISHED|REVIEW/)
    expect(gateway.withdrawEventAlbumPhoto).toHaveBeenCalledWith(photoId, 3)
    expect(() => module.withdrawEventAlbumPhoto(photoId, 0)).toThrow('照片状态无效')
  })
})
