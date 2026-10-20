import { useEffect, useState } from 'react'
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
 * - 只以图片引用集合为依赖，继续打字不会取消正在加载的图片；
 * - 在 600s 签名过期前刷新；失败限速重试，后台标签回到前台时补刷新。
 */
export function useCloudImageTempUrls(
  html: string | undefined,
  client: AdminApiClient | undefined,
  demoMode: boolean,
): Record<string, string> {
  const [resolved, setResolved] = useState<{
    client: AdminApiClient
    imageKey: string
    urls: Record<string, string>
  }>()
  const imageKey = JSON.stringify(extractRichTextCloudImageIds(normalizeRichTextToHtml(String(html || ''))))

  useEffect(() => {
    if (!client || demoMode) return
    const pending: string[] = JSON.parse(imageKey)
    if (!pending.length) return
    let cancelled = false
    let loading = false
    let refreshAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (cancelled || loading) return
      loading = true
      const urls: Record<string, string> = {}
      try {
        for (const batch of batchRichTextCloudImageIds(pending)) {
          if (cancelled) return
          try {
            Object.assign(urls, await client.tempUrls(batch))
          }
          catch {
            // 失败保持占位，不影响正文，也不把一次失败永久缓存。
          }
        }
        if (!cancelled) {
          setResolved(current => {
            // 初始失败仍是同一个空态，不重复重建预览里的 DOM。
            if (!current && !Object.keys(urls).length) return current
            if (current?.client === client && current.imageKey === imageKey
              && Object.keys(current.urls).length === Object.keys(urls).length
              && Object.entries(urls).every(([id, url]) => current.urls[id] === url)) return current
            return { client, imageKey, urls }
          })
          const delay = pending.every(id => urls[id]) ? 8 * 60_000 : 30_000
          refreshAt = Date.now() + delay
          timer = setTimeout(() => { void refresh() }, delay)
        }
      }
      finally {
        loading = false
      }
    }
    const resume = () => {
      if (document.visibilityState === 'hidden' || Date.now() < refreshAt || loading) return
      clearTimeout(timer)
      void refresh()
    }
    void refresh()
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [client, demoMode, imageKey])

  return !demoMode && resolved?.client === client && resolved?.imageKey === imageKey ? resolved.urls : {}
}
