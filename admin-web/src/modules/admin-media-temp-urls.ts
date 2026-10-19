/**
 * 存量 cloud:// 富文本插图的只读解析（MIW-125）。
 *
 * 浏览器无法直连 cloud://，预览与编辑器把存量 fileID 批量交给
 * `mip.admin.media.tempUrls`（600s 签名直链，仅 https、不落库）。
 * 解析失败的条目保持诚实占位，不阻断预览，也不伪造图片。
 */
import { escapeRichTextHtml } from './rich-text-html.ts'

export const ADMIN_MEDIA_TEMP_URLS_ACTION = 'mip.admin.media.tempUrls' as const

/** 契约封顶：单次解析的 fileID 数量上限（与服务端一致）。 */
export const ADMIN_MEDIA_TEMP_URLS_MAX_FILE_IDS = 30

const CLOUD_SRC_ATTRIBUTE = /\bsrc="(cloud:\/\/[^"]+)"/i
const CLOUD_IMAGE_TAG = /<img\b[^>]*\bsrc="(cloud:\/\/[^"]+)"[^>]*>/gi
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#]|$)/
// 用 span 而非 p：存量插图可能内联在段落里，块级占位会产生非法嵌套。
const PLACEHOLDER_HTML = '<span class="event-mobile-preview__image-placeholder">插图暂不可预览</span>'

/** 从受限 HTML 里按出现顺序提取去重后的存量 cloud:// fileID。 */
export function extractRichTextCloudImageIds(html: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of String(html || '').matchAll(CLOUD_IMAGE_TAG)) {
    const fileId = match[1]
    if (!seen.has(fileId)) {
      seen.add(fileId)
      ids.push(fileId)
    }
  }
  return ids
}

/** 只接受 https 临时地址；其余一律视为解析失败。 */
export function isHttpsTempUrl(value: unknown): value is string {
  return typeof value === 'string' && HTTPS_URL.test(value)
}

/**
 * 把 HTML 里的存量 cloud:// 插图替换成解析结果：
 * 命中 https 临时地址 → 换 src 渲染真图；未命中 → 诚实占位节点；其余内容原样保留。
 */
export function substituteRichTextCloudImages(html: string, resolved: Record<string, string>): string {
  return String(html || '').replace(CLOUD_IMAGE_TAG, (tag, fileId: string) => {
    const url = resolved[fileId]
    if (!isHttpsTempUrl(url)) return PLACEHOLDER_HTML
    return tag.replace(CLOUD_SRC_ATTRIBUTE, `src="${escapeRichTextHtml(url)}"`)
  })
}

/** 把待解析 fileID 切成契约封顶内的批次。 */
export function batchRichTextCloudImageIds(fileIds: string[]): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < fileIds.length; index += ADMIN_MEDIA_TEMP_URLS_MAX_FILE_IDS) {
    batches.push(fileIds.slice(index, index + ADMIN_MEDIA_TEMP_URLS_MAX_FILE_IDS))
  }
  return batches
}
