export interface ImageCompressionStep {
  width: number
  quality: number
}

export interface ImageUploadPolicy {
  label: string
  maximumBytes: number
  steps: readonly ImageCompressionStep[]
}

const HALF_MEGABYTE = 512 * 1024

export const IMAGE_UPLOAD_POLICIES = Object.freeze({
  avatar: {
    label: '头像',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 720, quality: 78 },
      { width: 640, quality: 66 },
      { width: 480, quality: 56 },
    ],
  },
  eventCover: {
    label: '活动封面',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1440, quality: 80 },
      { width: 1200, quality: 68 },
      { width: 1080, quality: 58 },
    ],
  },
  eventAlbum: {
    label: '活动照片',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1600, quality: 78 },
      { width: 1280, quality: 66 },
      { width: 1080, quality: 54 },
    ],
  },
  opportunityCover: {
    label: '机会封面',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1440, quality: 80 },
      { width: 1200, quality: 68 },
      { width: 1080, quality: 58 },
    ],
  },
  superCaseCover: {
    label: '案例封面',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1440, quality: 80 },
      { width: 1200, quality: 68 },
      { width: 1080, quality: 58 },
    ],
  },
  superCaseMedia: {
    label: '案例素材',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1600, quality: 78 },
      { width: 1280, quality: 66 },
      { width: 1080, quality: 54 },
    ],
  },
  taskAttachment: {
    label: '任务附件',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1600, quality: 78 },
      { width: 1280, quality: 66 },
      { width: 1080, quality: 54 },
    ],
  },
  taskTemplate: {
    label: '任务模板',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1600, quality: 80 },
      { width: 1280, quality: 68 },
      { width: 1080, quality: 58 },
    ],
  },
  banner: {
    label: 'Banner 图片',
    maximumBytes: HALF_MEGABYTE,
    steps: [
      { width: 1600, quality: 80 },
      { width: 1200, quality: 68 },
      { width: 960, quality: 58 },
    ],
  },
}) satisfies Record<string, ImageUploadPolicy>

export function estimateBase64Bytes(base64: string) {
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0)
  return Math.max(0, Math.floor(base64.length * 0.75) - padding)
}

function compressImage(src: string, step: ImageCompressionStep) {
  return new Promise<string>((resolve, reject) => {
    wx.compressImage({
      src,
      quality: step.quality,
      compressedWidth: step.width,
      success: result => resolve(result.tempFilePath),
      fail: reject,
    })
  })
}

function readBase64(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => {
        if (typeof result.data === 'string') {
          resolve(result.data)
          return
        }
        reject(new Error('图片读取失败，请重新选择'))
      },
      fail: reject,
    })
  })
}

export function chooseSingleImage(maximumBytes?: number) {
  return new Promise<string>((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: [maximumBytes ? 'original' : 'compressed'],
      success: (result) => {
        const file = result.tempFiles[0]
        const path = file?.tempFilePath
        if (maximumBytes && Number(file?.size || 0) > maximumBytes) {
          reject(new Error(`图片不能超过 ${Math.floor(maximumBytes / 1024 / 1024)}MB`))
          return
        }
        if (path) {
          resolve(path)
          return
        }
        reject(new Error('没有选择图片'))
      },
      fail: reject,
    })
  })
}

export function chooseMultipleImages(count: number) {
  return new Promise<string[]>((resolve, reject) => {
    wx.chooseMedia({
      count: Math.max(1, Math.min(9, Math.floor(count))),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const paths = result.tempFiles.map(item => item.tempFilePath).filter(Boolean)
        if (paths.length) {
          resolve(paths)
          return
        }
        reject(new Error('没有选择图片'))
      },
      fail: reject,
    })
  })
}

/**
 * Bounded, adaptive client pre-compression.
 *
 * The server still fully decodes, strips metadata, re-encodes and performs
 * content-safety checks. Client compression only avoids uploading needlessly
 * large originals and gives slow mobile networks a predictable payload.
 */
export async function compressImageToBase64(src: string, policy: ImageUploadPolicy) {
  for (const step of policy.steps) {
    // Sequential attempts intentionally stop at the first acceptable result.
    const compressed = await compressImage(src, step)
    const base64 = await readBase64(compressed)
    if (estimateBase64Bytes(base64) <= policy.maximumBytes) {
      return base64
    }
  }
  throw new Error(`${policy.label}压缩后仍然过大，请裁剪后重试`)
}
