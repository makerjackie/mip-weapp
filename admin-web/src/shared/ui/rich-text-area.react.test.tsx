import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RichTextArea, renderPreview } from './rich-text-area'

vi.mock('../../app/session-provider', () => ({ useAdminSession: () => null, useOptionalSession: () => null }))

describe('RichTextArea preview rendering', () => {
  it('mirrors the mini-program rich-content grammar (headings, lists, images)', () => {
    const html = renderPreview([
      '# 活动亮点',
      '## 流程',
      '- 签到',
      '- 交流',
      '',
      '![现场](https://img.example.com/scene.jpg)',
      '普通行文本',
    ].join('\n'))
    expect(html).toContain('<h2>活动亮点</h2>')
    expect(html).toContain('<h3>流程</h3>')
    expect(html).toContain('<li>签到</li>')
    expect(html).toContain('<img src="https://img.example.com/scene.jpg"')
    expect(html).toContain('<p>普通行文本</p>')
  })

  it('escapes HTML in content before injecting the preview (dangerouslySetInnerHTML)', () => {
    const html = renderPreview('<img src=x onerror=alert(1)>\n<script>bad()</script>')
    // 标签必须以文本形式转义出现，绝不产生可执行的元素
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('does not render non-https or credential-embedded image urls, matching the mini-program guard', () => {
    const html = renderPreview('![a](http://insecure.example.com/x.jpg)\n![b](https://user@evil.example.com/y.jpg)')
    expect(html).not.toContain('<img src="http://')
    expect(html).not.toContain('user@evil')
    // 不可用的图片链接退化为说明文字（alt 文本保留）
    expect(html).toContain('🖼 a')
    expect(html).toContain('🖼 b')
  })

  it('renders cloud:// rich-text images through the session preview mapping only', () => {
    const cloudId = 'cloud://env.mip/mip/staging/app/event-content/user/asset.png'
    // 没有映射时退化为占位说明：cloud:// 引用本身绝不进 <img src>。
    const unmapped = renderPreview(`![现场](${cloudId})`)
    expect(unmapped).not.toContain('<img')
    expect(unmapped).toContain('🖼 现场')
    // 本次会话上传过的图经签名直链预览，且该直链仍要过 https 安全校验。
    const mapped = renderPreview(`![现场](${cloudId})`, {
      [cloudId]: 'https://env.mip.tcb.qcloud.la/mip/staging/app/event-content/user/asset.png?sign=tmp',
    })
    expect(mapped).toContain('<img src="https://env.mip.tcb.qcloud.la/mip/staging/app/event-content/user/asset.png?sign=tmp"')
    const insecure = renderPreview(`![现场](${cloudId})`, { [cloudId]: 'http://insecure.example.com/x.jpg' })
    expect(insecure).not.toContain('<img')
  })

  it('wires the form label to the textarea through the injected id', () => {
    render(<RichTextArea id="intro" value="" onChange={() => {}} placeholder="写点什么" />)
    expect(document.getElementById('intro')).not.toBeNull()
    expect(screen.getByPlaceholderText('写点什么')).toBe(document.getElementById('intro'))
  })
})
