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
  if (normalized.length > 2048
    || !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#]|$)/.test(normalized)
    || /^https:\/\/[^/?#]*@/.test(normalized)) {
    return ''
  }
  return normalized
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
          nodes.push(element('p', image[1], { style: 'margin:0 0 12px;text-align:center;font-size:12px;color:#929a94;' }))
        }
        continue
      }
    }
    if (line.startsWith('## ')) {
      flushList()
      nodes.push(element('h3', line.slice(3).trim(), { style: 'margin:16px 0 8px;font-size:18px;font-weight:700;color:#f5f5f5;' }))
      continue
    }
    if (line.startsWith('# ')) {
      flushList()
      nodes.push(element('h2', line.slice(2).trim(), { style: 'margin:20px 0 8px;font-size:20px;font-weight:700;color:#f5f5f5;' }))
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
