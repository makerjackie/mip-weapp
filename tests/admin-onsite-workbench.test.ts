/* eslint-disable ts/no-use-before-define */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const event = {
  id: eventId,
  title: '现场活动',
  summary: '活动摘要',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '平台活动',
  status: 'PUBLISHED',
  contentSafetyStatus: 'PASSED',
  startsAt: '2026-09-20T10:00:00.000Z',
  endsAt: '2026-09-20T12:00:00.000Z',
  cityName: '上海',
  eventTypeKey: 'MEETUP',
  accessType: 'FREE',
  priceCents: 0,
  registrationPolicy: 'AUTO',
  albumEnabled: false,
  albumSubmissionPolicy: 'AUTO',
  capacity: 30,
  registrationCount: 1,
  attendedCount: 0,
  version: 1,
}
const detail = { ...event, description: '介绍', contentMedia: [], notices: '', coverAssetId: null, coverUrl: '', eventMode: 'OFFLINE', registrationDeadline: null, cancellationDeadline: null, venueName: '现场', address: '地址', latitude: null, longitude: null, onlineUrl: '', waitlistEnabled: false, registrationSchema: [] }
const roster = { id: registrationId, nickname: '参与者A', cityName: '上海', status: 'REGISTERED', answers: {}, answerItems: [], phoneBound: false, phoneNumber: null, submittedAt: '2026-09-19T10:00:00.000Z', registeredAt: '2026-09-19T10:00:00.000Z', checkedInAt: null, version: 1 }

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ enabled: true, capabilities: [
    { capability: 'events.roster.read', scopeType: 'EVENT', scopeId: '11111111-1111-4111-8111-111111111111' },
    { capability: 'events.checkin.manage', scopeType: 'EVENT', scopeId: '11111111-1111-4111-8111-111111111111' },
  ], roles: [] })),
  getEvent: vi.fn(async () => detail),
  createCheckInPoster: vi.fn(),
}))

vi.mock('../src/modules/mip-admin', () => ({
  hasScopedCapability: (capabilities: Array<{ capability: string, scopeType: string, scopeId: string | null }>, capability: string, scope: { scopeType: string, scopeId: string }) => capabilities.some(item => item.capability === capability && item.scopeType === scope.scopeType && item.scopeId === scope.scopeId),
  mipAdminModule: { session: { get: mocks.getSession }, events: { get: mocks.getEvent } },
}))
vi.mock('../src/platform/storage/cloud-media', () => ({ resolveCloudFileUrls: async <T>(value: T) => value }))
vi.mock('../src/modules/mip-admin/cloudbase-transport', () => ({ cloudbaseAdminTransport: { request: vi.fn() } }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: { createCheckInPoster: mocks.createCheckInPoster } }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: { cloudbase: {}, paymentMode: 'disabled', catalogStage: 'TEST', subscribeTemplatesJson: '{}', knowledgeWebviewAllowedHosts: [], unconfigured: { cloudbase: true, payment: true } } }))

describe('onsite event workbench runtime contracts', () => {
  it('parses non-empty event and roster DTOs from the real admin gateway parser', async () => {
    const { createMipAdminGateway } = await import('../src/modules/mip-admin/cloudbase-gateway')
    const transport = { request: vi.fn()
      .mockResolvedValueOnce({ items: [event], nextCursor: null })
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ items: [roster], nextCursor: null }) }
    const gateway = createMipAdminGateway(transport)
    await expect(gateway.listEvents()).resolves.toMatchObject({ items: [{ id: eventId, title: '现场活动' }] })
    await expect(gateway.getEvent(eventId)).resolves.toMatchObject({ id: eventId, venueName: '现场' })
    await expect(gateway.listRoster({ eventId, includePhone: false })).resolves.toMatchObject({
      items: [{ id: registrationId, nickname: '参与者A', status: 'REGISTERED' }],
    })
  })

  it('renders a non-empty event in the captured console Page instance', async () => {
    const definition = await importConsolePage()
    const page = createPage(definition, { eventId })
    await page.loadEvent()
    expect(page.data).toMatchObject({ state: 'ready', event: detail, eventStatusText: '已发布', canRoster: true, canCheckIn: true })
  })

  it('drops a stale response after the console page is hidden', async () => {
    const definition = await importConsolePage()
    let resolveEvent!: (value: typeof detail) => void
    const pending = new Promise<typeof detail>((resolve) => {
      resolveEvent = resolve
    })
    mocks.getEvent.mockReturnValueOnce(pending)
    const page = createPage(definition, { eventId })
    const request = page.loadEvent()
    page.onHide()
    resolveEvent(detail)
    await request
    expect(page.data.state).toBe('loading')
    expect(page.data.event).toBeNull()
  })

  it('draws a poster after the gateway supplies a native image path', async () => {
    const definition = await importConsolePage()
    let imageSrc = ''
    const context = { scale: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: () => ({ width: 10 }), fillStyle: '', font: '', textAlign: 'start' }
    const node = {
      width: 0,
      height: 0,
      getContext: () => context,
      createImage: () => {
        const image = { onload: () => undefined, onerror: () => undefined } as any
        Object.defineProperty(image, 'src', {
          get: () => imageSrc,
          set(value: string) {
            imageSrc = value
            queueMicrotask(() => image.onload())
          },
        })
        return image
      },
      requestAnimationFrame: (callback: () => void) => {
        callback()
        return 1
      },
    }
    const page = createPage(definition, {})
    page.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: (callback: (results: unknown[]) => void) => callback([{ node }]) }) }) })
    await page.drawCheckInPoster('/tmp/checkin-code.png', detail, 'STATIC')
    expect(imageSrc).toBe('/tmp/checkin-code.png')
    expect(wx.canvasToTempFilePath).toHaveBeenCalled()
  })

  it('shows poster failure and allows a successful retry', async () => {
    const definition = await importConsolePage()
    const page = createPage(definition, { event: detail, canCheckIn: true })
    page.drawCheckInPoster = vi.fn().mockResolvedValue('/tmp/poster.png')
    mocks.createCheckInPoster.mockRejectedValueOnce(new Error('海报服务暂时不可用'))
    await page.createCheckInPoster('STATIC')
    expect(page.data).toMatchObject({ posterBusy: false, message: '海报服务暂时不可用' })

    mocks.createCheckInPoster.mockResolvedValueOnce({ mode: 'STATIC', codeUrl: '/tmp/code.png', validUntil: '2026-09-20T12:00:00.000Z' })
    await page.createCheckInPoster('STATIC')
    expect(page.data).toMatchObject({ posterBusy: false, posterPath: '/tmp/poster.png', posterMode: 'STATIC' })
  })
})

type PageDefinition = Record<string, any>
let importedPage: PageDefinition | undefined

async function importConsolePage() {
  if (importedPage) {
    return importedPage
  }
  importedPage = undefined
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    importedPage = definition
  })
  vi.stubGlobal('wx', { getWindowInfo: () => ({ pixelRatio: 1 }), canvasToTempFilePath: vi.fn(({ success }: any) => success({ tempFilePath: '/tmp/poster.png' })) })
  await import('../src/packages/admin/event-console/index')
  return importedPage!
}

function createPage(definition: PageDefinition, patch: Record<string, unknown>) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...patch }
  page.setData = (value: Record<string, unknown>) => Object.assign(page.data, value)
  page.requestSeq = 0
  page.posterCountdownTimer = 0
  page.clearPosterCountdown = () => {
    page.posterCountdownTimer = 0
  }
  return page
}

beforeEach(() => {
  mocks.getSession.mockClear()
  mocks.getEvent.mockClear()
})
