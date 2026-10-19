import { useEffect, useRef, useState } from 'react'
import type { AdminApiClient } from '../../services/admin-api'
import {
  batchRichTextCloudImageIds,
  extractRichTextCloudImageIds,
} from '../../modules/admin-media-temp-urls'
import { normalizeRichTextToHtml } from '../../modules/rich-text-html'

/**
 * 把富文本里的存量 cloud:// fileID 批量解析成 600s 临时地址（MIW-125）。
 *
 * - 演示模式不发起请求、不伪造图片（与目录名称解析同一降级口径）；
 * - 失败 fail-soft：吞掉错误保持占位，不阻断预览；
 * - 同一 fileID 会话内只解析一次，失败条目也不反复重试。
 */
export function useCloudImageTempUrls(
  html: string | undefined,
  client: AdminApiClient | undefined,
  demoMode: boolean,
): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const attemptedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!client || demoMode) return
    // 入参可能是存量 markdown，先归一化成受限 HTML 再提取 cloud:// 引用。
    const pending = extractRichTextCloudImageIds(normalizeRichTextToHtml(String(html || '')))
      .filter(fileId => !attemptedRef.current.has(fileId))
    if (!pending.length) return
    let cancelled = false
    void (async () => {
      for (const batch of batchRichTextCloudImageIds(pending)) {
        for (const fileId of batch) attemptedRef.current.add(fileId)
        try {
          const result = await client.tempUrls(batch)
          if (cancelled || !Object.keys(result).length) continue
          setResolved(current => ({ ...current, ...result }))
        }
        catch {
          // 解析失败保持诚实占位；预览正文不受影响。
        }
      }
    })()
    return () => { cancelled = true }
  }, [client, demoMode, html])

  return resolved
}
