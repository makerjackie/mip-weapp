import type { CaseCloudClient } from './cloudbase'
import { replaceCloudFileUrls } from '@weapp/platform/media-urls'
import { requireCloudClient } from './cloudbase'

interface CachedMediaUrl {
  expiresAt: number
  url: string
}

const cache = new Map<string, CachedMediaUrl>()
const maximumBatchSize = 50
const maximumCachedFiles = 120
const maximumConcurrentDownloads = 3

const cloudImageTransforms = Object.freeze({
  avatar: 'imageMogr2/thumbnail/320x320>/format/webp/rquality/82',
  cover: 'imageMogr2/thumbnail/1200x>/format/webp/rquality/82',
  album: 'imageMogr2/thumbnail/1600x>/format/webp/rquality/82',
})

export function cloudImageTransformForFileId(fileId: string) {
  if (/\/avatars\//.test(fileId)) {
    return cloudImageTransforms.avatar
  }
  if (/\/(?:covers|event-covers|opportunity-covers|case-covers|banners)\//.test(fileId)) {
    return cloudImageTransforms.cover
  }
  if (/\/(?:event-album|album|case-media|task-attachments|task-templates)\//.test(fileId)) {
    return cloudImageTransforms.album
  }
  return ''
}

export function appendCloudImageTransform(url: string, transform: string) {
  if (!url || !transform) {
    return url
  }
  return `${url}${url.includes('?') ? '&' : '?'}${transform}`
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

function batches<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function downloadSignedUrl(url: string) {
  return new Promise<string>((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.downloadFile !== 'function') {
      reject(new Error('DOWNLOAD_UNAVAILABLE'))
      return
    }
    wx.downloadFile({
      url,
      success: (result) => {
        if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath) {
          resolve(result.tempFilePath)
          return
        }
        reject(new Error('DOWNLOAD_FAILED'))
      },
      fail: reject,
    })
  })
}

async function signedUrls(cloud: CaseCloudClient, fileIds: string[]) {
  const urls = new Map<string, string>()
  try {
    for (const fileList of batches(fileIds, maximumBatchSize)) {
      // The CloudBase API limit makes sequential batches predictable and small.
      const response = await cloud.getTempFileURL({ fileList })
      for (const item of response.fileList) {
        if (item.status === 0 && item.tempFileURL) {
          urls.set(item.fileID, item.tempFileURL)
        }
      }
    }
  }
  catch {
    // Native CloudBase download remains the compatibility fallback.
  }
  return urls
}

async function downloadCloudFiles(cloud: CaseCloudClient, fileIds: string[]) {
  const paths = new Map<string, string>()
  const temporaryUrls = await signedUrls(cloud, fileIds)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < fileIds.length) {
      const fileId = fileIds[nextIndex]
      nextIndex += 1
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const temporaryUrl = temporaryUrls.get(fileId)
          if (temporaryUrl) {
            const transform = cloudImageTransformForFileId(fileId)
            const localPath = await downloadSignedUrl(
              appendCloudImageTransform(temporaryUrl, transform),
            )
            paths.set(fileId, localPath)
            break
          }
          const result = await cloud.downloadFile({ fileID: fileId })
          if (result.tempFilePath) {
            paths.set(fileId, result.tempFilePath)
            break
          }
        }
        catch {
          // Retry a bounded read once; signed HTTPS remains the final fallback.
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrentDownloads, fileIds.length) }, () => worker()),
  )
  return paths
}

/** Resolves CloudBase file IDs to process-local files before native images render. */
export async function resolveCloudFileUrls<T>(value: T, providedCloud?: CaseCloudClient): Promise<T> {
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
    const localPaths = await downloadCloudFiles(cloud, missing)
    for (const [fileId, localPath] of localPaths) {
      cacheMediaFile(fileId, localPath)
      urls.set(fileId, localPath)
    }

    const unresolved = missing.filter(fileId => !localPaths.has(fileId))
    try {
      const fallbackUrls = await signedUrls(cloud, unresolved)
      for (const [fileId, tempFileURL] of fallbackUrls) {
        if (tempFileURL) {
          // Signed URLs are intentionally not added to the process cache.
          // A later business query gets another chance to localize the file.
          urls.set(
            fileId,
            appendCloudImageTransform(tempFileURL, cloudImageTransformForFileId(fileId)),
          )
        }
      }
    }
    catch {
      // Leave unresolved media empty rather than passing a cloud:// ID into a
      // native image compatibility path that reloads and emits warnings.
    }
    for (const fileId of unresolved) {
      if (!urls.has(fileId)) {
        urls.set(fileId, '')
      }
    }
  }

  return replaceCloudFileUrls(value, urls)
}
