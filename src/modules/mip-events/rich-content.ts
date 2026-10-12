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

function safeImageUrl(value: string) {
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
export function extractRichTextCloudImageIds(value: string) {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of String(value || '').matchAll(/!\[[^\]]{0,120}\]\((cloud:\/\/[^)\s]+)\)/g)) {
    const id = match[1].trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function eventRichTextNodes(value: string): EventRichTextNode[] {
  const lines = String(value || '').replace(/\r\n?/g, '\n').slice(0, 20_000).split('\n')
  const nodes: EventRichTextNode[] = []
  let listItems: EventRichTextNode[] = []
  const flushList = () => {
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
