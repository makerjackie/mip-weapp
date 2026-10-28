import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaPreviewProvider } from '../../shared/ui/media-preview-provider'
import { EventMobilePreview, EventMobilePreviewWithData } from './event-mobile-preview'

// 会话可按用例注入：client 未设置时视同无会话（存量 cloud:// 解析不发起请求）。
const sessionState = vi.hoisted(() => ({
  client: undefined as { tempUrls: (fileIds: string[]) => Promise<Record<string, string>> } | undefined,
  demoMode: false,
  request: vi.fn(),
}))
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => (sessionState.client ? { client: sessionState.client, demoMode: sessionState.demoMode, request: sessionState.request } : null),
}))

afterEach(() => {
  cleanup()
  sessionState.client = undefined
  sessionState.demoMode = false
})

describe('event preview online access', () => {
  it('does not promise a venue link that an offline save discards', () => {
    render(<EventMobilePreview values={{ eventMode: 'OFFLINE', onlineUrl: 'https://example.com/venue' }} />)
    expect(screen.queryByRole('link', { name: '进入线上活动' })).not.toBeInTheDocument()
  })

  it('shows the HTTPS online link for hybrid activities', () => {
    render(<EventMobilePreview values={{ eventMode: 'HYBRID', onlineUrl: 'https://example.com/meeting' }} />)
    expect(screen.getByRole('link', { name: '进入线上活动' })).toHaveAttribute('href', 'https://example.com/meeting')
  })

  it('never renders a non-HTTPS online link the save would reject', () => {
    render(<EventMobilePreview values={{ eventMode: 'ONLINE', onlineUrl: 'http://example.com/meeting' }} />)
    expect(screen.queryByRole('link', { name: '进入线上活动' })).not.toBeInTheDocument()
  })
})

describe('event preview detail fidelity', () => {
  it('retains guest ticket price without an automatic exemption chip', () => {
    render(<EventMobilePreview values={{ accessType: 'PAID', memberFree: true, priceCents: 1990 }} />)
    expect(screen.queryByText('玩家免费')).not.toBeInTheDocument()
    expect(screen.getByText('19.90')).toBeInTheDocument()
  })

  it('mirrors the mini program info card: folded time, location fallback and price row', () => {
    render(<EventMobilePreview values={{
      title: 'MIP 早会第 328 场',
      startsAt: '2026-11-06T02:00:00.000Z',
      endsAt: '2026-11-06T04:00:00.000Z',
      cityName: '上海',
      venueName: '徐汇某空间',
      accessType: 'PAID',
      priceCents: 58900,
    }} />)
    expect(screen.getByText('MIP 早会第 328 场')).toBeInTheDocument()
    // 与小程序 compactEventTime 同口径：同日折叠为「M月D日 HH:mm-HH:mm」（本地时区）。
    const start = new Date('2026-11-06T02:00:00.000Z')
    const end = new Date('2026-11-06T04:00:00.000Z')
    const clock = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
    const monthDay = `${start.getMonth() + 1}月${start.getDate()}日`
    expect(screen.getByText(`${monthDay} ${clock(start)}-${clock(end)}`)).toBeInTheDocument()
    expect(screen.getByText('上海 · 徐汇某空间')).toBeInTheDocument()
    // 付费活动：角标「付费活动」+ 右上价格位（整数元不带小数）。
    expect(screen.queryByText('付费活动')).not.toBeInTheDocument()
    expect(screen.getByText('¥')).toBeInTheDocument()
    expect(screen.getByText('589')).toBeInTheDocument()
  })

  it('does not synthesize access chips when no labels are configured', () => {
    render(<EventMobilePreview values={{ accessType: 'MEMBER_INCLUDED' }} />)
    expect(screen.queryByText('玩家活动')).not.toBeInTheDocument()
    expect(screen.queryByText('¥')).not.toBeInTheDocument()
  })

  it('does not synthesize a legacy type chip', () => {
    render(<EventMobilePreview values={{ eventTypeKey: 'general' }} />)
    expect(screen.queryByText('活动')).not.toBeInTheDocument()
  })

  it('switches content sections through the detail page tabs', async () => {
    const user = userEvent.setup()
    render(<EventMobilePreview values={{ description: '<p>正文介绍</p>', organizerIntroduction: '<p>主办方背景</p>' }} />)
    expect(screen.getByText('正文介绍')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '主办方' }))
    expect(screen.getByText('主办方背景')).toBeInTheDocument()
    expect(screen.queryByText('正文介绍')).not.toBeInTheDocument()
  })

  it('never renders a raw cloud:// image the browser cannot decode', () => {
    render(<EventMobilePreview values={{ description: '<p>图</p><img src="cloud://env/a.jpg" alt="活动图片">' }} />)
    expect(screen.getByText('插图保存后在活动页显示')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '活动图片' })).not.toBeInTheDocument()
  })

  it('shows rich text cloud images once this session can resolve their addresses', () => {
    render(
      <MediaPreviewProvider existingUrls={{ 'cloud://env/a.jpg': 'blob:preview-a' }}>
        <EventMobilePreview values={{ description: '<p>图</p><img src="cloud://env/a.jpg" alt="活动图片">' }} />
      </MediaPreviewProvider>,
    )
    expect(screen.getByRole('img', { name: '活动图片' })).toHaveAttribute('src', 'blob:preview-a')
    expect(screen.queryByText('插图保存后在活动页显示')).not.toBeInTheDocument()
  })

  it('shows honest empty states for pre-creation participants', () => {
    render(<EventMobilePreview values={{}} />)
    expect(screen.getByText('参与人数0')).toBeInTheDocument()
    expect(screen.getByText('暂无公开参与者资料')).toBeInTheDocument()
  })

  it('keeps the schema fields out of the phone frame but annotates them below', () => {
    render(<EventMobilePreview values={{
      registrationSchema: [
        { key: 'company', label: '公司', type: 'TEXT', required: true },
        { key: 'track', label: '赛道', type: 'SELECT', options: ['AI', '硬件'] },
      ],
    }} />)
    expect(screen.getByText('公司（必填）')).toBeInTheDocument()
    expect(screen.getByText('赛道：AI / 硬件')).toBeInTheDocument()
    expect(screen.getByText('报名页收集字段（详情页不展示）')).toBeInTheDocument()
  })
})

describe('event preview legacy cloud images (MIW-125)', () => {
  const legacyDescription = '<p>存量介绍</p><img src="cloud://legacy-a.png" alt="现场">'

  it('resolves existing cloud:// references through the read-only action and renders the real image', async () => {
    const tempUrls = vi.fn(async (fileIds: string[]) => ({
      [fileIds[0]]: 'https://tmp.example/legacy-a.png?sign=x',
    }))
    sessionState.client = { tempUrls }
    render(<EventMobilePreview values={{ description: legacyDescription }} />)
    const image = await screen.findByRole('img', { name: '现场' })
    expect(image).toHaveAttribute('src', 'https://tmp.example/legacy-a.png?sign=x')
    expect(tempUrls).toHaveBeenCalledWith(['cloud://legacy-a.png'])
    expect(screen.queryByText('插图保存后在活动页显示')).not.toBeInTheDocument()
  })

  it('keeps an honest placeholder and the rest of the preview when resolution fails', async () => {
    sessionState.client = { tempUrls: vi.fn(async () => { throw new Error('SERVICE_UNAVAILABLE') }) }
    render(<EventMobilePreview values={{ description: legacyDescription, title: '存量活动' }} />)
    const placeholder = await screen.findByText('插图保存后在活动页显示')
    expect(placeholder).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '现场' })).not.toBeInTheDocument()
    // 解析失败不阻断预览：标题与其余正文照常展示。
    expect(screen.getByText('存量活动')).toBeInTheDocument()
    expect(screen.getByText('存量介绍')).toBeInTheDocument()
  })

  it('skips resolution in demo mode without faking images', async () => {
    const tempUrls = vi.fn()
    sessionState.client = { tempUrls }
    sessionState.demoMode = true
    render(<EventMobilePreview values={{ description: legacyDescription }} />)
    await waitFor(() => expect(screen.getByText('插图保存后在活动页显示')).toBeInTheDocument())
    expect(tempUrls).not.toHaveBeenCalled()
  })
})


it('resolves real nonempty catalog objects and subsequent pages into preview labels', async () => {
  sessionState.client = { tempUrls: vi.fn().mockResolvedValue({}) }
  sessionState.request.mockImplementation(async (action: string, input: Record<string, unknown>) => {
    if (action === 'mip.admin.branches.list') return { items: [{ id: 'branch-1', name: '上海服务器' }] }
    if (input.kind === 'TYPE') return { items: [{ key: 'type-1', name: '资源交流' }] }
    return input.cursor ? { items: [{ id: 'tag-2', name: '集会' }] } : { items: [{ id: 'tag-1', name: '早会', backgroundColor: '#fcdf03', textColor: '#000000' }], nextCursor: 'next-page' }
  })
  render(<EventMobilePreviewWithData values={{ scopeType: 'BRANCH', branchId: 'branch-1', eventTypeKey: 'type-1', tagIds: ['tag-1', 'tag-2'] }} />)
  expect(screen.queryByText('上海服务器')).not.toBeInTheDocument()
  expect(await screen.findByText('早会')).toHaveStyle({ backgroundColor: '#fcdf03', color: '#000000' })
  expect(await screen.findByText('集会')).toBeVisible()
  expect(screen.queryByText('资源交流')).not.toBeInTheDocument()
})
