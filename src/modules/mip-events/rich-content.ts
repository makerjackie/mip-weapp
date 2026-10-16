export interface EventRichTextNode {
  name?: string
  type?: 'text'
  text?: string
  attrs?: Record<string, string>
  children?: EventRichTextNode[]
}

function textNode(text: string): EventRichTextNode {
  return { type: 'text', text }
}

function element(name: string, text: string, attrs: Record<string, string> = {}): EventRichTextNode {
  return { name, attrs, children: [textNode(text)] }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, '\'')
    .replace(/&#x27;/gi, '\'')
    .replace(/&apos;/g, '\'')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function safeImageUrl(value: string): string {
  const normalized = value.trim()
  if (normalized.length > 2048) {
    return ''
  }
  // 远程图仅放行 https；cloud:// 由详情页先走本地下载管道解析成 wxfile:// 临时路径
  // （或开发者工具的 http://tmp/ 路径）后再进节点，未解析的 cloud:// 不直接渲染。
  if (/^wxfile:\/\//.test(normalized) || /^http:\/\/tmp\//.test(normalized)) {
    return normalized
  }
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#]|$)/.test(normalized)
    || /^https:\/\/[^/?#]*@/.test(normalized)) {
    return ''
  }
  return normalized
}

/** 富文本里待解析的 cloud:// 插图引用（按出现顺序去重），详情页批量转本地路径后再渲染。 */
export function extractRichTextCloudImageIds(value: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of String(value || '').matchAll(/cloud:\/\/[^\s"'<>()]+/g)) {
    const id = match[0]
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

const RICH_TEXT_TAG_RE = /^(?:p|br|strong|[biua]|em|ul|ol|li|h[1-6]|img|div|span)$/
const RICH_TEXT_HTML_RE = /<(?:p|br|strong|[biua]|em|ul|ol|li|h[1-6]|img|div|span)\b/i

/** 是否是本模块认可的受限 HTML（而不是存量 markdown 文本）。 */
export function isRichTextHtml(value: string): boolean {
  return RICH_TEXT_HTML_RE.test(String(value || ''))
}

const BLOCK_STYLE: Record<string, string> = {
  p: 'margin:8px 0;line-height:1.75;color:#b3b3b3;',
  h2: 'margin:20px 0 8px;font-size:20px;font-weight:700;color:#ffffff;',
  h3: 'margin:16px 0 8px;font-size:18px;font-weight:700;color:#ffffff;',
  h4: 'margin:14px 0 8px;font-size:16px;font-weight:700;color:#ffffff;',
  ul: 'margin:8px 0;padding-left:20px;color:#b3b3b3;',
  ol: 'margin:8px 0;padding-left:22px;color:#b3b3b3;',
  li: 'margin:5px 0;line-height:1.7;',
  img: 'display:block;width:100%;margin:14px 0 6px;border-radius:8px;',
}
const INLINE_STYLE: Record<string, string> = {
  strong: 'font-weight:700;',
  em: 'font-style:italic;',
  u: 'text-decoration:underline;',
}

function normalizeTagName(tag: string): string {
  if (tag === 'b') {
    return 'strong'
  }
  if (tag === 'i') {
    return 'em'
  }
  if (tag === 'h1') {
    return 'h2'
  }
  if (tag === 'h2') {
    return 'h3'
  }
  if (tag === 'h3') {
    return 'h4'
  }
  if (tag === 'div') {
    return 'p'
  }
  if (tag === 'a') {
    return 'span'
  }
  return tag
}

/** 只从 style 里保留受支持的对齐声明，其余样式一律丢弃。 */
function alignmentStyle(style: string | undefined): string {
  if (!style) {
    return ''
  }
  const match = /text-align\s*:\s*(left|center|right|justify)/i.exec(style)
  return match ? `text-align:${match[1].toLowerCase()};` : ''
}

function attribute(source: string, name: string): string | undefined {
  if (!source) {
    return undefined
  }
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const match = pattern.exec(source)
  if (!match) {
    return undefined
  }
  return decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '')
}

interface ParsedTag {
  name: string
  attrs: string
  closing: boolean
  selfClosing: boolean
  next: number
}

/** 逐字符扫描一个标签（引号内的 `>` 不算结束），避免复杂正则回溯。 */
function readTag(html: string, start: number): ParsedTag {
  let cursor = start + 1
  let quote = ''
  while (cursor < html.length) {
    const ch = html[cursor]
    if (quote) {
      if (ch === quote) {
        quote = ''
      }
    }
    else if (ch === '"' || ch === '\'') {
      quote = ch
    }
    else if (ch === '>') {
      break
    }
    cursor += 1
  }
  const inner = html.slice(start + 1, cursor)
  const closing = inner.startsWith('/')
  const body = (closing ? inner.slice(1) : inner).trimStart()
  const selfClosing = body.endsWith('/')
  const trimmed = selfClosing ? body.slice(0, -1) : body
  const nameMatch = /^[a-z][a-z0-9]*/i.exec(trimmed)
  const name = nameMatch ? nameMatch[0] : ''
  return {
    name,
    attrs: name ? trimmed.slice(name.length) : '',
    closing,
    selfClosing,
    next: cursor + 1,
  }
}

interface ParseFrame {
  node: EventRichTextNode
  container: EventRichTextNode[]
}

function closeTag(stack: ParseFrame[], rawTag: string): void {
  const name = normalizeTagName(rawTag)
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].node.name === name) {
      stack.length = index
      return
    }
  }
}

/**
 * 把受限 HTML 转成微信 <rich-text> 节点。只认白名单标签；未知标签被丢弃但保留其文本，
 * 属性除 style(text-align)、图片 src/alt 外一律不透传，避免把存储层内容当成可执行标记。
 */
function htmlToNodes(html: string): EventRichTextNode[] {
  const root: EventRichTextNode[] = []
  const stack: ParseFrame[] = [{ node: { children: root }, container: root }]
  const push = (node: EventRichTextNode): void => {
    stack[stack.length - 1].container.push(node)
  }
  const appendText = (text: string): void => {
    if (text) {
      push(textNode(decodeHtmlEntities(text)))
    }
  }
  let index = 0
  while (index < html.length) {
    const lt = html.indexOf('<', index)
    if (lt === -1) {
      appendText(html.slice(index))
      break
    }
    appendText(html.slice(index, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt)
      index = end === -1 ? html.length : end + 3
      continue
    }
    const parsed = readTag(html, lt)
    index = parsed.next
    if (!parsed.name) {
      continue
    }
    const tag = parsed.name.toLowerCase()
    if (!RICH_TEXT_TAG_RE.test(tag)) {
      continue
    }
    if (parsed.closing) {
      closeTag(stack, tag)
      continue
    }
    if (tag === 'br') {
      push({ name: 'br', attrs: {} })
      continue
    }
    if (tag === 'img') {
      const src = safeImageUrl(attribute(parsed.attrs, 'src') || '')
      if (src) {
        push({ name: 'img', attrs: { src, alt: attribute(parsed.attrs, 'alt') || '', style: BLOCK_STYLE.img, mode: 'widthFix' } })
      }
      continue
    }
    const name = normalizeTagName(tag)
    const style = `${BLOCK_STYLE[name] || ''}${INLINE_STYLE[name] || ''}${name === 'p' ? alignmentStyle(attribute(parsed.attrs, 'style')) : ''}`
    const node: EventRichTextNode = { name, attrs: style ? { style } : {}, children: [] }
    push(node)
    if (!parsed.selfClosing) {
      stack.push({ node, container: node.children as EventRichTextNode[] })
    }
  }
  return root
}

/** 存量 markdown 子集（`# `/`## `/`- `/`![]()`）解析，保持历史内容可读。 */
function legacyMarkdownNodes(value: string): EventRichTextNode[] {
  const lines = String(value || '').replace(/\r\n?/g, '\n').slice(0, 20_000).split('\n')
  const nodes: EventRichTextNode[] = []
  let listItems: EventRichTextNode[] = []
  const flushList = (): void => {
    if (listItems.length) {
      nodes.push({ name: 'ul', attrs: { style: 'margin:8px 0;padding-left:20px;color:#b3b3b3;' }, children: listItems })
      listItems = []
    }
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      continue
    }
    const image = /^!\[([^\]]{0,120})\]\(([^)]+)\)$/.exec(line)
    if (image) {
      flushList()
      const source = safeImageUrl(image[2].trim())
      if (source) {
        nodes.push({
          name: 'img',
          attrs: {
            src: source,
            alt: image[1],
            style: 'display:block;width:100%;margin:14px 0 6px;border-radius:8px;',
            mode: 'widthFix',
          },
        })
        if (image[1]) {
          nodes.push(element('p', image[1], { style: 'margin:0 0 12px;text-align:center;font-size:12px;color:#b3b3b3;' }))
        }
      }
      // 不可渲染的图片行（待水合的 cloud:// 引用、非法协议）整行跳过，
      // 不回退成普通文本——避免把原始 markdown 暴露给用户或页面数据。
      continue
    }
    if (line.startsWith('## ')) {
      flushList()
      nodes.push(element('h3', line.slice(3).trim(), { style: 'margin:16px 0 8px;font-size:18px;font-weight:700;color:#ffffff;' }))
      continue
    }
    if (line.startsWith('# ')) {
      flushList()
      nodes.push(element('h2', line.slice(2).trim(), { style: 'margin:20px 0 8px;font-size:20px;font-weight:700;color:#ffffff;' }))
      continue
    }
    if (line.startsWith('- ')) {
      listItems.push(element('li', line.slice(2).trim(), { style: 'margin:5px 0;line-height:1.7;' }))
      continue
    }
    flushList()
    nodes.push(element('p', line, { style: 'margin:8px 0;line-height:1.75;color:#b3b3b3;' }))
  }
  flushList()
  return nodes
}

export function eventRichTextNodes(value: string): EventRichTextNode[] {
  const source = String(value || '')
  if (!source.trim()) {
    return []
  }
  return isRichTextHtml(source) ? htmlToNodes(source.slice(0, 60_000)) : legacyMarkdownNodes(source)
}
