import DOMPurify from 'dompurify'
import { RICH_TEXT_ALLOWED_TAGS, safeRichImageUrl } from '../../modules/rich-text-html'

const ALLOWED_TAGS = [...RICH_TEXT_ALLOWED_TAGS, 'span']
const ALLOWED_ATTR = ['src', 'alt', 'style']

/** 只保留对齐声明，其余 CSS（含可被滥用的 url()/expression）一律丢弃。 */
function cleanStyle(raw: string | null): string {
  if (!raw) return ''
  const match = /text-align\s*:\s*(left|center|right|justify)/i.exec(raw)
  return match ? `text-align:${match[1].toLowerCase()}` : ''
}

/**
 * 白名单净化：DOMPurify 去掉脚本/事件/危险协议，再逐元素收紧 style（只留对齐）与 img src。
 * 用于写入前和渲染前，保证入库与预览都不会被执行型内容污染。
 * 浏览器/jsdom 专用（依赖 document）；node 合同测试不要引用本文件。
 */
export function sanitizeRichTextHtml(value: string): string {
  const source = String(value || '')
  if (!source.trim()) return ''
  const clean = DOMPurify.sanitize(source, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:cloud|https|wxfile):|\/)/i,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  })
  if (typeof document === 'undefined') return clean
  const holder = document.createElement('div')
  holder.innerHTML = clean
  holder.querySelectorAll('*').forEach(node => {
    const element = node as HTMLElement
    const style = cleanStyle(element.getAttribute('style'))
    if (style) element.setAttribute('style', style)
    else element.removeAttribute('style')
    if (element.tagName.toLowerCase() === 'img') {
      element.setAttribute('src', safeRichImageUrl(element.getAttribute('src') || ''))
      if (!element.getAttribute('src')) { element.remove(); return }
      element.setAttribute('alt', element.getAttribute('alt') || '')
    }
    for (const attr of Array.from(element.attributes)) {
      if (!['src', 'alt', 'style'].includes(attr.name)) element.removeAttribute(attr.name)
    }
  })
  return holder.innerHTML
}
