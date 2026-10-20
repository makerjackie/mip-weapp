import type { CaseCloudClient } from '../cloudbase/client'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../cloudbase/client'
import { measureLoading } from '../cloudbase/loading-diagnostics'
import { replaceCloudFileUrls } from './media-urls'

interface CachedMediaUrl {
  expiresAt: number
  url: string
}

const cache = new Map<string, CachedMediaUrl>()
const downloads = new Map<string, Promise<string>>()
let cacheGeneration = 0
const maximumCachedFiles = 120
const maximumConcurrentDownloads = 3
let activeDownloads = 0
const downloadWaiters: Array<() => void> = []

async function withDownloadSlot<T>(run: () => Promise<T>, background: boolean): Promise<T> {
  if (activeDownloads >= maximumConcurrentDownloads) {
    await new Promise<void>((resolve) => {
      if (background) {
        downloadWaiters.push(resolve)
      }
      else {
        downloadWaiters.unshift(resolve)
      }
    })
  }
  else {
    activeDownloads += 1
  }
  try {
    return await run()
  }
  finally {
    const next = downloadWaiters.shift()
    if (next) {
      next()
    }
    else {
      activeDownloads -= 1
    }
  }
}

function cacheMediaFile(fileId: string, url: string, expiresAt = Number.POSITIVE_INFINITY) {
  cache.delete(fileId)
  cache.set(fileId, { url, expiresAt })
  while (cache.size > maximumCachedFiles) {
    const oldest = cache.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    cache.delete(oldest)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collectCloudFileIds(value: unknown, result = new Set<string>()) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://')) {
      result.add(value)
    }
    return result
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectCloudFileIds(item, result))
    return result
  }
  if (isRecord(value)) {
    Object.values(value).forEach(item => collectCloudFileIds(item, result))
  }
  return result
}

function isErrorDocumentPath(path: string) {
  return /\.(?:html?|json|txt|xml)(?:$|[?#])/i.test(path)
}

function cachedMedia(fileId: string) {
  const entry = cache.get(fileId)
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(fileId)
    return undefined
  }
  if (/^(?:wxfile:\/\/|http:\/\/tmp\/)/.test(entry.url)
    && typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function') {
    try {
      wx.getFileSystemManager().accessSync(entry.url)
    }
    catch {
      cache.delete(fileId)
      return undefined
    }
  }
  return entry
}

async function publicEventMedia(cloud: CaseCloudClient, fileIds: string[]) {
  const urls = new Map<string, string>()
  for (let offset = 0; offset < fileIds.length; offset += 30) {
    const batch = fileIds.slice(offset, offset + 30)
    try {
      const response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.eventsFunctionName,
        data: { action: 'mip.events.mediaUrls', fileIds: batch },
      })
      const result = response.result as { ok?: boolean, data?: { urls?: Record<string, unknown> } } | undefined
      if (result?.ok !== true) {
        continue
      }
      for (const fileId of batch) {
        const url = result.data?.urls?.[fileId]
        if (typeof url === 'string' && /^https:\/\/[^\s/@]+(?:\/|$)/.test(url)) {
          urls.set(fileId, url)
        }
      }
    }
    catch {
      // A failed image read must not turn successful event/order content into an error.
    }
  }
  return urls
}

async function downloadCloudFile(cloud: CaseCloudClient, fileId: string, background: boolean): Promise<string> {
  const cached = cachedMedia(fileId)
  if (cached) {
    return cached.url
  }
  const pending = downloads.get(fileId)
  if (pending) {
    return pending
  }
  const generation = cacheGeneration
  const flight = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await withDownloadSlot(() => cloud.downloadFile({ fileID: fileId }), background)
        if (result.tempFilePath && (result.statusCode === undefined || result.statusCode === 200)
          && !isErrorDocumentPath(result.tempFilePath)) {
          if (generation === cacheGeneration) {
            cacheMediaFile(fileId, result.tempFilePath)
          }
          return result.tempFilePath
        }
      }
      catch {
        // Retry one native read; failed files remain empty instead of showing an error document.
      }
    }
    return ''
  })()
  downloads.set(fileId, flight)
  try {
    return await flight
  }
  finally {
    if (downloads.get(fileId) === flight) {
      downloads.delete(fileId)
    }
  }
}

async function downloadCloudFiles(cloud: CaseCloudClient, fileIds: string[], background: boolean) {
  const paths = new Map<string, string>()
  let nextIndex = 0

  async function worker() {
    while (nextIndex < fileIds.length) {
      const fileId = fileIds[nextIndex]
      nextIndex += 1
      const localPath = await downloadCloudFile(cloud, fileId, background)
      if (localPath) {
        paths.set(fileId, localPath)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrentDownloads, fileIds.length) }, () => worker()),
  )
  return paths
}

/** Resolves CloudBase file IDs to process-local files before native images render. */
export async function resolveCloudFileUrls<T>(value: T, providedCloud?: CaseCloudClient, background = false): Promise<T> {
  const resolveGeneration = cacheGeneration
  const fileIds = [...collectCloudFileIds(value)]
  if (!fileIds.length) {
    return value
  }

  const urls = new Map<string, string>()
  const missing: string[] = []
  for (const fileId of fileIds) {
    const cached = cachedMedia(fileId)
    if (cached) {
      urls.set(fileId, cached.url)
      cache.delete(fileId)
      cache.set(fileId, cached)
    }
    else {
      cache.delete(fileId)
      missing.push(fileId)
    }
  }

  if (missing.length) {
    const cloud = providedCloud || await requireCloudClient()
    const localPaths = await measureLoading('media.download', () => downloadCloudFiles(cloud, missing, background))
    const publicUrls = await publicEventMedia(cloud, missing.filter(fileId => !localPaths.has(fileId)))
    for (const [fileId, url] of publicUrls) {
      if (resolveGeneration === cacheGeneration) {
        cacheMediaFile(fileId, url, Date.now() + 8 * 60 * 1000)
      }
      urls.set(fileId, url)
    }
    for (const [fileId, localPath] of localPaths) {
      if (resolveGeneration === cacheGeneration) {
        cacheMediaFile(fileId, localPath)
      }
      urls.set(fileId, localPath)
    }

    for (const fileId of missing) {
      if (!localPaths.has(fileId) && !publicUrls.has(fileId)) {
        // Broken downloads can contain an XML/HTML storage error document.
        urls.set(fileId, '')
      }
    }
  }

  return replaceCloudFileUrls(value, urls)
}

export function clearCloudMediaCache() {
  cacheGeneration += 1
  cache.clear()
  downloads.clear()
}

export function getCloudMediaGeneration() {
  return cacheGeneration
}

/** Synchronous image state: retain cached/local URLs, hide unresolved cloud IDs. */
export function peekCloudFileUrls<T>(value: T): T {
  const urls = new Map<string, string>()
  for (const fileId of collectCloudFileIds(value)) {
    urls.set(fileId, cachedMedia(fileId)?.url || '')
  }
  return replaceCloudFileUrls(value, urls)
}
