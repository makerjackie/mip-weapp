// AI 语音填写客户端直传链路:
// prepareVoiceUpload(拿 HMAC 归属路径) → wx.cloud.uploadFile → createVoiceDraftStorage(复验+转写+结构化)。
// 音频从不进入 callFunction 报文,摘要用于服务端确认云端字节就是客户端录制的字节。

import type { AiDraft, AiDraftPurpose, AiVoiceUploadPreparation, MipAiGateway } from './types'
import type { VoiceRecordingResult } from './voice-recorder'
import { sha256Hex } from '../../platform/crypto/sha256'
import { createIntentKey } from '../mip-shell/presentation'

// 依赖里的 cloud 缺省时才懒加载平台客户端,避免单元测试触碰构建期全局。
async function defaultCloudClient() {
  const { requireCloudClient } = await import('../../platform/cloudbase/client')
  return requireCloudClient()
}

interface FileSystemManagerLike {
  readFile: (options: {
    filePath: string
    success?: (result: { data: ArrayBuffer }) => void
    fail?: (error: { errMsg?: string }) => void
  }) => void
}

interface CloudStorageClient {
  uploadFile: (options: { cloudPath: string, filePath: string }) => Promise<{ fileID?: string }>
}

export interface VoiceDraftUpload {
  preparation: AiVoiceUploadPreparation
  fileId: string
  contentSha256: string
  contentBytes: number
}

export function createVoiceNoteFlow(
  gateway: MipAiGateway,
  deps: { fileSystem?: FileSystemManagerLike, cloud?: CloudStorageClient } = {},
) {
  // 不传 encoding 时 readFile 返回 ArrayBuffer;平台类型因 encoding 可选而放宽为 string|ArrayBuffer。
  const fileSystem = (deps.fileSystem || wx.getFileSystemManager()) as FileSystemManagerLike

  function readFileBytes(filePath: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      fileSystem.readFile({
        filePath,
        success: result => resolve(result.data),
        fail: error => reject(new Error(error?.errMsg || '录音文件读取失败')),
      })
    })
  }

  async function uploadRecording(purpose: AiDraftPurpose, recording: VoiceRecordingResult): Promise<VoiceDraftUpload> {
    if (!recording.filePath) {
      throw new Error('录音文件不可用，请重新录制')
    }
    const preparation = await gateway.prepareVoiceUpload(purpose)
    const cloud = deps.cloud || await defaultCloudClient()
    const uploaded = await cloud.uploadFile({ cloudPath: preparation.objectKey, filePath: recording.filePath })
    const fileId = typeof uploaded?.fileID === 'string' ? uploaded.fileID : ''
    if (!fileId.startsWith('cloud://') || !fileId.endsWith(preparation.objectKey)) {
      throw new Error('录音上传结果异常，请重试')
    }
    const bytes = recording.bytes || new Uint8Array(await readFileBytes(recording.filePath))
    if (!bytes.length) {
      throw new Error('录音内容为空，请重新录制')
    }
    return {
      preparation,
      fileId,
      contentSha256: sha256Hex(bytes),
      contentBytes: bytes.length,
    }
  }

  async function createVoiceDraftFromRecording(
    purpose: AiDraftPurpose,
    recording: VoiceRecordingResult,
  ): Promise<AiDraft> {
    const upload = await uploadRecording(purpose, recording)
    // 每次确认都是一次新的提交尝试:换新幂等键,避免命中已 FAILED 的请求记录。
    return gateway.createVoiceDraftStorage({
      purpose,
      audioAssetId: upload.preparation.assetId,
      fileId: upload.fileId,
      contentType: 'audio/mpeg',
      contentBytes: upload.contentBytes,
      contentSha256: upload.contentSha256,
      requestId: createIntentKey('ai-draft-voice-storage'),
    })
  }

  return { readFileBytes, uploadRecording, createVoiceDraftFromRecording }
}
