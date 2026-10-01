import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  canvasToTempFilePath: vi.fn(),
}))

vi.mock('../src/config/brand', () => ({ brand: { productName: 'MIP', logoPath: '' } }))
vi.mock('../src/config/mip-operations', () => ({ mipOperationsConfig: {} }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {}, mipCheckInResumeStore: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))
vi.mock('../src/platform/storage/cloud-media', () => ({ peekCloudFileUrls: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({ clearComponentMedia: vi.fn(), updateComponentMedia: vi.fn() }))
vi.mock('../src/platform/wechat/channels', () => ({ openWechatChannelsDestination: vi.fn() }))

interface TestImage { onload?: () => void, onerror?: (error: unknown) => void, src?: string }
interface CanvasCall { text: string, x: number, y: number, maxWidth?: number }

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  vi.stubGlobal('wx', {
    showToast: mocks.showToast,
    getWindowInfo: () => ({ pixelRatio: 2 }),
    canvasToTempFilePath: mocks.canvasToTempFilePath,
  })
  await import('../src/packages/member/mip-events/detail/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canvasToTempFilePath.mockImplementation(({ success }: { success: (result: { tempFilePath: string }) => void }) => success({ tempFilePath: '/tmp/invitation.png' }))
})

function page() {
  const instance = Object.create(definition)
  instance.data = {
    ...definition.data,
    event: {
      title: 'MIP 活动',
      summary: '活动介绍',
      startsAt: '2026-10-02T10:00:00.000Z',
      endsAt: '2026-10-02T12:00:00.000Z',
    },
    startsText: '10月2日 18:00-20:00',
    locationText: '深圳南山区科技园',
  }
  instance.setData = (value: Record<string, unknown>) => {
    Object.assign(instance.data, value)
  }
  return instance
}

describe('event invitation poster', () => {
  it('wraps the inviter, long event title, and location without compressing text', async () => {
    const calls: CanvasCall[] = []
    const cardRects: Array<{ x: number, y: number, width: number, height: number }> = []
    const context = {
      fillStyle: '',
      font: '',
      textAlign: 'start',
      scale: vi.fn(),
      fillRect: (x: number, y: number, width: number, height: number) => cardRects.push({ x, y, width, height }),
      measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
      fillText: (text: string, x: number, y: number, maxWidth?: number) => calls.push({ text, x, y, maxWidth }),
      drawImage: vi.fn(),
    }
    const image = {} as TestImage
    Object.defineProperty(image, 'src', {
      get: () => '',
      set: (_source: string) => image.onload?.(),
    })
    const node = {
      width: 0,
      height: 0,
      createImage: () => image,
      getContext: () => context,
      requestAnimationFrame: (callback: () => void) => {
        callback()
        return 1
      },
    }
    const instance = page()
    instance.data.event.title = '很长的活动标题'.repeat(8)
    instance.data.locationText = '深圳南山区科技园地址'.repeat(8)
    instance.createSelectorQuery = () => ({
      select: () => ({ fields: () => ({ exec: (callback: (results: Array<{ node: typeof node }>) => void) => callback([{ node }]) }) }),
    })

    await expect(instance.drawInvitationPoster('https://example.test/code.png', 'Jackie')).resolves.toBe('/tmp/invitation.png')

    expect(calls.some(call => call.text === 'Jackie 邀请你一起参加')).toBe(true)
    expect(calls.filter(call => call.y === 104 || call.y === 131)).toHaveLength(2)
    expect(calls.filter(call => call.y >= 184 && call.y < 240)).toHaveLength(3)
    expect(calls.every(call => call.maxWidth === undefined)).toBe(true)
    const lastLocationY = calls.filter(call => call.text.startsWith('深圳南山区科技园地址')).at(-1)?.y || 0
    expect(cardRects.find(rect => rect.x === 28)?.y).toBeGreaterThan(lastLocationY)
  })
})
