import type { CaseCloudClient } from '../cloudbase/client'
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

function cacheMediaFile(fileId: string, url: string) {
  cache.delete(fileId)
  cache.set(fileId, { url, expiresAt: Number.POSITIVE_INFINITY })
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

async function downloadCloudFile(cloud: CaseCloudClient, fileId: string, background: boolean): Promise<string> {
  const cached = cache.get(fileId)
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
        if (result.tempFilePath && !isErrorDocumentPath(result.tempFilePath)) {
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
  const now = Date.now()
  const fileIds = [...collectCloudFileIds(value)]
  if (!fileIds.length) {
    return value
  }

  const urls = new Map<string, string>()
  const missing: string[] = []
  for (const fileId of fileIds) {
    const cached = cache.get(fileId)
    if (cached && cached.expiresAt > now) {
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
    for (const [fileId, localPath] of localPaths) {
      if (resolveGeneration === cacheGeneration) {
        cacheMediaFile(fileId, localPath)
      }
      urls.set(fileId, localPath)
    }

    for (const fileId of missing) {
      if (!localPaths.has(fileId)) {
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
    urls.set(fileId, cache.get(fileId)?.url || '')
  }
  return replaceCloudFileUrls(value, urls)
}
