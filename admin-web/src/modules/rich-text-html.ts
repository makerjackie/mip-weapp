/**
 * 活动图文（活动介绍 / 主办方介绍 / 报名须知）统一使用「受限 HTML」存储。
 *
 * 白名单：p / br / strong / em / u / ul / ol / li / h1–h3 / img（块级对齐用 text-align）。
 * 与小程序 `src/modules/mip-events/rich-content.ts` 的解析白名单逐条对齐；
 * 存量 markdown 子集（`# `/`## `/`- `/`![]()`）在读取时归一化成等价 HTML，历史内容不丢。
 *
 * 本模块只放纯函数（无 DOM 依赖），可在 node 合同测试里安全引用；
 * DOMPurify 净化放在 `rich-text-sanitize.ts`（浏览器/jsdom 专用）。
 */
export const RICH_TEXT_ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'img'] as const

export function escapeRichTextHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 是否为受限 HTML（与小程序 isRichTextHtml 同口径）。 */
export function isRichTextHtml(value: string): boolean {
  return new RegExp(`<(?:${RICH_TEXT_ALLOWED_TAGS.join('|')})\\b`, 'i').test(String(value || ''))
}

/** 存量 markdown 子集 → 等价 HTML，保持历史内容可读、可再次编辑。 */
export function legacyMarkdownToHtml(value: string): string {
  const lines = String(value || '').replace(/\r\n?/g, '\n').slice(0, 60_000).split('\n')
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
      const src = image[2].trim()
      if (safeRichImageUrl(src)) {
        html.push(`<img src="${escapeRichTextHtml(src)}" alt="${escapeRichTextHtml(image[1])}">`)
      }
      continue
    }
    if (line.startsWith('## ')) { flushList(); html.push(`<h2>${escapeRichTextHtml(line.slice(3).trim())}</h2>`); continue }
    if (line.startsWith('# ')) { flushList(); html.push(`<h1>${escapeRichTextHtml(line.slice(2).trim())}</h1>`); continue }
    if (line.startsWith('- ')) { list.push(`<li>${escapeRichTextHtml(line.slice(2).trim())}</li>`); continue }
    flushList()
    html.push(`<p>${escapeRichTextHtml(line)}</p>`)
  }
  flushList()
  return html.join('')
}

/** 把任意存储值（受限 HTML 或存量 markdown）归一化成受限 HTML。 */
export function normalizeRichTextToHtml(value: string): string {
  const source = String(value || '')
  if (!source.trim()) return ''
  return isRichTextHtml(source) ? source : legacyMarkdownToHtml(source)
}

/** 与小程序 safeImageUrl 同口径的图片地址白名单。 */
export function safeRichImageUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 2048) return ''
  if (/^cloud:\/\/[^\s]+$/i.test(normalized)) return normalized
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#]|$)/.test(normalized) && !/^https:\/\/[^/?#]*@/.test(normalized)) return normalized
  return ''
}

export function richTextIsEmpty(value: string): boolean {
  const html = normalizeRichTextToHtml(value)
  return richTextToPlainText(html).trim().length === 0 && !/<img\b/i.test(html)
}

/** 纯文本长度（用于字数上限与内容安全送审前的长度估计）。 */
export function richTextToPlainText(value: string): string {
  return normalizeRichTextToHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|h[1-6]|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 编辑器需要稳定比较「外部值」与「当前内容」时使用：归一化后去空白转小写。 */
export function richTextSignature(value: string): string {
  return normalizeRichTextToHtml(value).replace(/\s+/g, '').toLowerCase()
}
