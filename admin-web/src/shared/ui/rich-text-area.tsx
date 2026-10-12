import { Button, Input, type InputRef } from 'antd'
import { useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminMediaFile } from '../../modules/admin-media-upload'

/**
 * Safely access the admin session. Returns null outside a SessionProvider
 * (unit tests render the field without a full provider tree).
 */
function useOptionalSession() {
  try {
    return useAdminSession()
  }
  catch {
    return null
  }
}

/**
 * 轻量富文本编辑器：所见即所得预览 + 受限标记语法。
 *
 * 语法与小程序端解析器（src/modules/mip-events/rich-content.ts · eventRichTextNodes）逐条对齐：
 *   `# 大标题` / `## 小标题` / `- 列表项` / `![图片说明](cloud://…)`（独占一行）/ 普通文本行。
 * 不支持其它 Markdown 语法——超出部分小程序端会按普通文本展示，因此工具栏只提供上述五种操作。
 * 插图走活动素材上传通道（mip.admin.media.uploadImage），插入稳定 cloud:// fileID；
 * 小程序详情页会把它解析成本地临时路径再渲染。服务端返回的签名直链只有 10 分钟时效，
 * 持久化后必挂，仅用于本编辑器本次会话的预览。
 */
export function RichTextArea({
  id,
  value = '',
  onChange,
  placeholder,
  maxLength,
  disabled,
  rows = 8,
}: {
  /** Form.Item injects the label-associated id; pass it through to the textarea. */
  id?: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  rows?: number
}) {
  const session = useOptionalSession()
  const client = session?.client
  const demoMode = session?.demoMode ?? false
  /** AntD types omit resizableTextArea; this is the underlying <textarea> used for cursor math. */
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const setArea = (instance: InputRef | null) => {
    areaRef.current = (instance as unknown as { resizableTextArea?: { textArea: HTMLTextAreaElement } })?.resizableTextArea?.textArea ?? null
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  /** cloud:// fileID → 上传时返回的短时效签名直链，只服务本次会话的预览渲染。 */
  const [previewImages, setPreviewImages] = useState<Record<string, string>>({})

  const emit = (next: string) => onChange?.(maxLength ? next.slice(0, maxLength) : next)

  /** 把片段插入光标处（无光标则追加到末尾），并保证前后各一个空行（块级语法要求独占一行）。 */
  const insertBlock = (snippet: string) => {
    const el = areaRef.current
    const current = String(value || '')
    if (!el) { emit(`${current}${current && !current.endsWith('\n') ? '\n' : ''}${snippet}\n`); return }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const before = current.slice(0, start)
    const after = current.slice(end)
    const pad = (text: string) => text && !text.endsWith('\n') ? `${text}\n` : text
    const next = `${pad(before)}${snippet}\n${after.startsWith('\n') || !after ? after : `\n${after}`}`
    emit(next)
    requestAnimationFrame(() => {
      const at = pad(before).length + snippet.length + 1
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  const wrapSelection = (prefix: string) => {
    const el = areaRef.current
    const current = String(value || '')
    if (!el) { emit(`${current}${prefix}`); return }
    const start = el.selectionStart ?? current.length
    const lineStart = current.lastIndexOf('\n', start - 1) + 1
    emit(`${current.slice(0, lineStart)}${prefix}${current.slice(lineStart)}`)
    requestAnimationFrame(() => {
      const at = lineStart + prefix.length
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  const handlePickImage = async (file: File) => {
    if (!client) { setUploadError('当前环境无法上传图片'); return }
    if (demoMode) { setUploadError('演示模式不会上传图片'); return }
    setUploading(true)
    setUploadError('')
    try {
      const mediaFile: AdminMediaFile = {
        name: file.name, size: file.size, type: file.type, arrayBuffer: () => file.arrayBuffer(),
      }
      const result = await client.uploadImage(mediaFile, 'EVENT_CONTENT')
      const stableRef = result.cloudFileId
      if (!stableRef) {
        setUploadError('图片上传结果缺少稳定引用，请重试')
        return
      }
      if (/^https:\/\//.test(result.imageUrl) && !result.imageUrl.includes('@')) {
        setPreviewImages(current => ({ ...current, [stableRef]: result.imageUrl }))
      }
      insertBlock(`![图片](${stableRef})`)
    }
    catch { setUploadError('图片上传失败，请重试') }
    finally { setUploading(false) }
  }

  return (
    <div className="rich-text-area" data-disabled={disabled || undefined}>
      <div className="rich-text-area__toolbar" role="toolbar" aria-label="富文本工具栏">
        <Button size="small" disabled={disabled} onClick={() => wrapSelection('# ')}># 大标题</Button>
        <Button size="small" disabled={disabled} onClick={() => wrapSelection('## ')}>## 小标题</Button>
        <Button size="small" disabled={disabled} onClick={() => wrapSelection('- ')}>- 列表</Button>
        <Button size="small" disabled={disabled || uploading} loading={uploading}
          onClick={() => fileRef.current?.click()}>🖼 插入图片</Button>
        <span className="rich-text-area__count">{String(value || '').length}{maxLength ? ` / ${maxLength}` : ''}</span>
      </div>
      {uploadError ? <div className="rich-text-area__error" role="alert">{uploadError}</div> : null}
      <Input.TextArea
        ref={setArea}
        id={id}
        value={value}
        onChange={event => emit(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        rows={rows}
      />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handlePickImage(file)
        }} />
      <details className="rich-text-area__preview">
        <summary>实时预览（成员在小程序中看到的效果）</summary>
        {/* 预览 HTML 由本文件内的 escapeHtml + renderPreview 生成，输入均经转义，无用户可控的原始 HTML。 */}
        <div className="rich-text-area__rendered" dangerouslySetInnerHTML={{ __html: renderPreview(String(value || ''), previewImages) }} />
      </details>
    </div>
  )
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 与小程序 eventRichTextNodes 同规则的预览渲染（仅用于管理后台预览）。
 *  cloud:// 插图引用经 previewImages 映射成本次会话的签名直链预览；没有映射时退化为占位说明。 */
export function renderPreview(value: string, previewImages: Record<string, string> = {}): string {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let list: string[] = []
  const flushList = () => {
    if (list.length) { html.push(`<ul>${list.join('')}</ul>`); list = [] }
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { flushList(); continue }
    const image = /^!\[([^\]]{0,120})\]\(([^)]+)\)$/.exec(line)
    if (image) {
      flushList()
      const source = image[2].trim()
      const cloudPreview = source.startsWith('cloud://') ? previewImages[source] : undefined
      const safe = cloudPreview && /^https:\/\//.test(cloudPreview) && !cloudPreview.includes('@')
        ? cloudPreview
        : /^https:\/\//.test(source) && !source.includes('@') ? source : ''
      html.push(safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(image[1])}" />` : `<p>🖼 ${escapeHtml(image[1] || '图片（链接暂不可显示）')}</p>`)
      continue
    }
    if (line.startsWith('## ')) { flushList(); html.push(`<h3>${escapeHtml(line.slice(3))}</h3>`); continue }
    if (line.startsWith('# ')) { flushList(); html.push(`<h2>${escapeHtml(line.slice(2))}</h2>`); continue }
    if (line.startsWith('- ')) { list.push(`<li>${escapeHtml(line.slice(2))}</li>`); continue }
    flushList()
    html.push(`<p>${escapeHtml(line)}</p>`)
  }
  flushList()
  return html.join('') || '<p class="empty">暂无内容</p>'
}
