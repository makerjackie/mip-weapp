import type { ImageUploadPolicy } from '../../platform/wechat/image-upload'
import type { MipMediaGateway, MipMediaPurpose } from './types'
import { compressImageToBase64, estimateBase64Bytes, IMAGE_UPLOAD_POLICIES } from '../../platform/wechat/image-upload'
import { mipMediaPurposes } from './types'

const MAX_CLIENT_IMAGE_BYTES = 1024 * 1024

const policies: Record<MipMediaPurpose, ImageUploadPolicy> = {
  AVATAR: IMAGE_UPLOAD_POLICIES.avatar,
  EVENT_COVER: IMAGE_UPLOAD_POLICIES.eventCover,
  EVENT_CONTENT: IMAGE_UPLOAD_POLICIES.eventAlbum,
  EVENT_ALBUM: IMAGE_UPLOAD_POLICIES.eventAlbum,
  OPPORTUNITY_COVER: IMAGE_UPLOAD_POLICIES.opportunityCover,
  SUPER_CASE_COVER: IMAGE_UPLOAD_POLICIES.superCaseCover,
  SUPER_CASE_MEDIA: IMAGE_UPLOAD_POLICIES.superCaseMedia,
  TASK_ATTACHMENT: IMAGE_UPLOAD_POLICIES.taskAttachment,
  TASK_TEMPLATE: IMAGE_UPLOAD_POLICIES.taskTemplate,
  BANNER: IMAGE_UPLOAD_POLICIES.banner,
}

export function createMipMediaModule(gateway: MipMediaGateway) {
  function assertPurpose(purpose: MipMediaPurpose) {
    if (!mipMediaPurposes.includes(purpose)) {
      throw new Error('素材用途无效')
    }
  }

  async function uploadImageBase64(purpose: MipMediaPurpose, imageBase64: string) {
    assertPurpose(purpose)
    if (estimateBase64Bytes(imageBase64) > MAX_CLIENT_IMAGE_BYTES) {
      throw new Error('图片过大，请压缩后重试')
    }
    return gateway.uploadImage(purpose, imageBase64)
  }

  return {
    uploadImageBase64,

    async uploadImageFromPath(purpose: MipMediaPurpose, sourcePath: string) {
      assertPurpose(purpose)
      if (!sourcePath.trim()) {
        throw new Error('没有选择图片')
      }
      const imageBase64 = await compressImageToBase64(sourcePath, policies[purpose])
      return uploadImageBase64(purpose, imageBase64)
    },
  }
}
