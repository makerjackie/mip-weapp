import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRichTextHtml,
  legacyMarkdownToHtml,
  normalizeRichTextToHtml,
  richTextIsEmpty,
  richTextToPlainText,
} from '../../modules/rich-text-html'
import { sanitizeRichTextHtml } from './rich-text-sanitize'
import { RichTextArea } from './rich-text-area'

// 会话可按用例注入：null = 无 Provider 树；client = 真实登录会话形态（hook 只依赖 tempUrls）。
const sessionState = vi.hoisted(() => ({
  client: undefined as { tempUrls: (fileIds: string[]) => Promise<Record<string, string>> } | undefined,
  demoMode: false,
}))
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => (sessionState.client ? { client: sessionState.client, demoMode: sessionState.demoMode } : null),
  useOptionalSession: () => (sessionState.client ? { client: sessionState.client, demoMode: sessionState.demoMode } : null),
}))

afterEach(() => {
  cleanup()
  sessionState.client = undefined
  sessionState.demoMode = false
})

describe('rich text HTML helpers', () => {
  it('normalizes legacy markdown to equivalent HTML', () => {
    const html = legacyMarkdownToHtml('# 活动亮点\n## 流程\n- 签到\n- 交流\n![现场](https://img.example.com/scene.jpg)\n普通行文本')
    expect(html).toContain('<h1>活动亮点</h1>')
    expect(html).toContain('<h2>流程</h2>')
    expect(html).toContain('<ul><li>签到</li><li>交流</li></ul>')
    expect(html).toContain('<img src="https://img.example.com/scene.jpg"')
    expect(html).toContain('<p>普通行文本</p>')
  })

  it('detects restricted HTML and passes it through unchanged', () => {
    const html = '<p>一段<strong>加粗</strong></p>'
    expect(isRichTextHtml(html)).toBe(true)
    expect(normalizeRichTextToHtml(html)).toBe(html)
  })

  it('escapes legacy text so raw markup is never emitted as HTML', () => {
    const html = legacyMarkdownToHtml('<script>bad()</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('computes plain-text length and emptiness for the counter and validation', () => {
    expect(richTextToPlainText('<p>你好<strong>世界</strong></p>')).toBe('你好世界')
    expect(richTextIsEmpty('<p></p>')).toBe(true)
    expect(richTextIsEmpty('')).toBe(true)
    expect(richTextIsEmpty('<p><img src="cloud://x/a.png"></p>')).toBe(false)
  })
})

describe('sanitizeRichTextHtml', () => {
  it('keeps allowed formatting and blocks scripts, events and dangerous urls', () => {
    const clean = sanitizeRichTextHtml('<p onclick="alert(1)">安全<script>bad()</script><img src="javascript:alert(1)"></p><strong>x</strong>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('<strong>x</strong>')
    expect(clean).toContain('安全')
  })

  it('keeps only text-align in style and drops other css', () => {
    const clean = sanitizeRichTextHtml('<p style="text-align:center;background:url(javascript:alert(1))">居中</p>')
    expect(clean).toContain('text-align:center')
    expect(clean).not.toContain('background')
    expect(clean).not.toContain('javascript')
  })

  it('keeps cloud:// and https image sources but drops others', () => {
    const cloud = sanitizeRichTextHtml('<img src="cloud://env.mip/mip/staging/app/a.png">')
    expect(cloud).toContain('src="cloud://env.mip/mip/staging/app/a.png"')
    const insecure = sanitizeRichTextHtml('<img src="http://insecure.example.com/x.jpg">')
    expect(insecure).not.toContain('<img')
  })
})

describe('RichTextArea editor', () => {
  it('renders a contenteditable bound to the injected form id', () => {
    render(<RichTextArea id="intro" value="" onChange={() => {}} placeholder="写点什么" />)
    const root = document.getElementById('intro')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('contenteditable')).toBe('true')
  })

  // 工具栏 antd 图标也占 role="img"，编辑器里解析出的真图按专属类名定位。
  const resolvedEditorImage = () => document.querySelector('img.rich-text-editor__image')

  it('shows the resolved real image for a legacy cloud:// reference (MIW-125)', async () => {
    sessionState.client = {
      tempUrls: vi.fn(async () => ({ 'cloud://legacy-a.png': 'https://tmp.example/legacy-a.png?sign=x' })),
    }
    render(<RichTextArea id="intro" value={normalizeRichTextToHtml('<p>介绍</p><img src="cloud://legacy-a.png">')} onChange={() => {}} />)
    await waitFor(() => {
      const image = resolvedEditorImage()
      expect(image).not.toBeNull()
      expect(image).toHaveAttribute('src', 'https://tmp.example/legacy-a.png?sign=x')
    })
    expect(screen.queryByText('图片（保存后在活动页显示）')).not.toBeInTheDocument()
  })

  it('keeps the honest placeholder for a legacy cloud:// reference when resolution fails', async () => {
    sessionState.client = {
      tempUrls: vi.fn(async () => { throw new Error('SERVICE_UNAVAILABLE') }),
    }
    render(<RichTextArea id="intro" value={normalizeRichTextToHtml('<img src="cloud://legacy-a.png">')} onChange={() => {}} />)
    expect(await screen.findByText('图片（保存后在活动页显示）')).toBeInTheDocument()
    expect(resolvedEditorImage()).toBeNull()
  })

  it('skips resolution in demo mode without faking images', async () => {
    const tempUrls = vi.fn()
    sessionState.client = { tempUrls }
    sessionState.demoMode = true
    render(<RichTextArea id="intro" value={normalizeRichTextToHtml('<img src="cloud://legacy-a.png">')} onChange={() => {}} />)
    expect(await screen.findByText('图片（保存后在活动页显示）')).toBeInTheDocument()
    expect(resolvedEditorImage()).toBeNull()
    expect(tempUrls).not.toHaveBeenCalled()
  })
})
