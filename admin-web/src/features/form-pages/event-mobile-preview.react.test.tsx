import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventMobilePreview } from './event-mobile-preview'

// 会话可按用例注入：null = 无 Provider 树；client = 真实登录会话形态（hook 只依赖 tempUrls）。
const sessionState = vi.hoisted(() => ({
  client: undefined as { tempUrls: (fileIds: string[]) => Promise<Record<string, string>> } | undefined,
  demoMode: false,
}))
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => (sessionState.client ? { client: sessionState.client, demoMode: sessionState.demoMode } : null),
}))

afterEach(() => {
  cleanup()
  sessionState.client = undefined
  sessionState.demoMode = false
})

describe('event preview online access', () => {
  it('does not promise a venue link that an offline save discards', () => {
    render(<EventMobilePreview values={{ eventMode: 'OFFLINE', onlineUrl: 'https://example.com/venue' }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the HTTPS online link for hybrid activities', () => {
    render(<EventMobilePreview values={{ eventMode: 'HYBRID', onlineUrl: 'https://example.com/meeting' }} />)
    expect(screen.getByRole('link', { name: '线上活动链接' })).toHaveAttribute('href', 'https://example.com/meeting')
  })
})

describe('event preview legacy cloud images (MIW-125)', () => {
  const legacyDescription = '<p>活动介绍</p><img src="cloud://legacy-a.png" alt="现场">'

  it('resolves existing cloud:// references through the read-only action and renders the real image', async () => {
    const tempUrls = vi.fn(async (fileIds: string[]) => ({
      [fileIds[0]]: 'https://tmp.example/legacy-a.png?sign=x',
    }))
    sessionState.client = { tempUrls }
    render(<EventMobilePreview values={{ description: legacyDescription }} />)
    const image = await screen.findByRole('img', { name: '现场' })
    expect(image).toHaveAttribute('src', 'https://tmp.example/legacy-a.png?sign=x')
    expect(tempUrls).toHaveBeenCalledWith(['cloud://legacy-a.png'])
  })

  it('keeps an honest placeholder and the rest of the preview when resolution fails', async () => {
    sessionState.client = { tempUrls: vi.fn(async () => { throw new Error('SERVICE_UNAVAILABLE') }) }
    render(<EventMobilePreview values={{ description: legacyDescription, title: '存量活动' }} />)
    const placeholder = await screen.findByText('插图暂不可预览')
    expect(placeholder).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '现场' })).not.toBeInTheDocument()
    // 解析失败不阻断预览：标题与其余正文照常展示（卡片标题与正文段落都会出现该文案）。
    expect(screen.getByText('存量活动')).toBeInTheDocument()
    expect(screen.getAllByText('活动介绍').length).toBeGreaterThanOrEqual(1)
  })

  it('skips resolution in demo mode without faking images', async () => {
    const tempUrls = vi.fn()
    sessionState.client = { tempUrls }
    sessionState.demoMode = true
    render(<EventMobilePreview values={{ description: legacyDescription }} />)
    await waitFor(() => expect(screen.getByText('插图暂不可预览')).toBeInTheDocument())
    expect(tempUrls).not.toHaveBeenCalled()
  })
})
