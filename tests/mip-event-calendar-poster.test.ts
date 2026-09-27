import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canIUse: vi.fn(),
  addPhoneCalendar: vi.fn(),
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
    canIUse: mocks.canIUse,
    addPhoneCalendar: mocks.addPhoneCalendar,
    showToast: mocks.showToast,
    getWindowInfo: () => ({ pixelRatio: 2 }),
    canvasToTempFilePath: mocks.canvasToTempFilePath,
  })
  await import('../src/packages/member/mip-events/detail/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canIUse.mockReturnValue(true)
  mocks.addPhoneCalendar.mockResolvedValue(undefined)
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

describe('event calendar and invitation poster', () => {
  it('reports unsupported calendar APIs without trying to call them', async () => {
    mocks.canIUse.mockReturnValue(false)
    const instance = page()

    await instance.addToCalendar()

    expect(mocks.addPhoneCalendar).not.toHaveBeenCalled()
    expect(instance.data.message).toBe('当前微信版本不支持加入系统日历。')
  })

  it('keeps the calendar end time as a string and handles the WeChat cancel errMsg', async () => {
    mocks.addPhoneCalendar.mockRejectedValue({ errMsg: 'addPhoneCalendar:fail cancel' })
    const instance = page()

    await instance.addToCalendar()

    const [calendarEvent] = mocks.addPhoneCalendar.mock.calls[0] as [{ startTime: number, endTime: string }]
    expect(typeof calendarEvent.endTime).toBe('string')
    expect(calendarEvent.endTime).toBe(String(Math.floor(new Date(instance.data.event.endsAt).getTime() / 1000)))
    expect(mocks.showToast).toHaveBeenCalledWith({ title: '已取消加入日历', icon: 'none' })
    expect(instance.data.message).toBe('')
  })

  it('surfaces the WeChat errMsg for non-cancel failures', async () => {
    mocks.addPhoneCalendar.mockRejectedValue({ errMsg: 'addPhoneCalendar:fail no permission' })
    const instance = page()

    await instance.addToCalendar()

    expect(instance.data.message).toBe('加入系统日历失败：addPhoneCalendar:fail no permission')
  })

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
