import type { AiDraftId, UserId } from '../src/modules/mip'
import type { MipAiGateway } from '../src/modules/mip-ai'
import { describe, expect, it, vi } from 'vitest'
import { createMipAiModule } from '../src/modules/mip-ai'
import { createVoiceNoteFlow } from '../src/modules/mip-ai/voice-note'
import { sha256Hex } from '../src/platform/crypto/sha256'

const draft = {
  id: '20000000-0000-4000-8000-000000000001' as AiDraftId,
  userId: '10000000-0000-4000-8000-000000000001' as UserId,
  purpose: 'SUPER_CASE' as const,
  status: 'DRAFT_READY' as const,
  transcriptText: '项目内容',
  structuredDraft: { projectName: '项目' },
  expiresAt: '2099-01-01T00:00:00.000Z',
  version: 2,
}

const preparation = {
  purpose: 'SUPER_CASE' as const,
  assetId: '30000000-0000-4000-8000-000000000001',
  objectKey: 'mip/development/a0a0a0a0a0a0a0a0a0a0a0a0/ai/b0b0b0b0b0b0b0b0b0b0b0b0/30000000-0000-4000-8000-000000000001.mp3',
  contentType: 'audio/mpeg' as const,
  maximumContentBytes: 6 * 1024 * 1024,
}

function gateway(overrides: Partial<MipAiGateway> = {}): MipAiGateway {
  return {
    getCapability: async () => ({ textDrafts: true, voiceDrafts: true, refinementDrafts: true, digitalAvatars: false }),
    listDrafts: async () => ({ items: [] }),
    getDraft: async () => draft,
    createTextDraft: async () => draft,
    createVoiceDraft: async () => draft,
    createVoiceDraftUpload: async () => draft,
    prepareVoiceUpload: async () => preparation,
    createVoiceDraftStorage: async () => draft,
    continueDraft: async () => draft,
    updateDraft: async () => draft,
    deleteDraft: async draftId => ({ draftId, status: 'DELETED' }),
    listDigitalAvatars: async () => ({ items: [] }),
    generateDigitalAvatar: async () => { throw new Error('not configured') },
    ...overrides,
  }
}

describe('sha256 (mini program implementation)', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex(new TextEncoder().encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    // 跨块(>64 字节)输入。
    expect(sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
})

describe('AI voice note direct upload flow', () => {
  it('prepares, uploads to the allocated path, then creates the draft with digest', async () => {
    const bytes = new TextEncoder().encode('fake-mp3-bytes')
    const createVoiceDraftStorage = vi.fn(async () => draft)
    const prepareVoiceUpload = vi.fn(async () => preparation)
    const uploadFile = vi.fn(async (input: { cloudPath: string, filePath: string }) => ({
      fileID: `cloud://env/${input.cloudPath}`,
    }))
    const flow = createVoiceNoteFlow(gateway({ prepareVoiceUpload, createVoiceDraftStorage }), {
      cloud: { uploadFile },
      fileSystem: {
        readFile: () => { throw new Error('must not read when bytes are in memory') },
      },
    })
    const result = await flow.createVoiceDraftFromRecording('SUPER_CASE', {
      filePath: 'wxfile://usr/mip-ai-voice.mp3',
      durationMs: 65_000,
      bytes,
    })
    expect(result).toEqual(draft)
    expect(prepareVoiceUpload).toHaveBeenCalledWith('SUPER_CASE')
    expect(uploadFile).toHaveBeenCalledWith({ cloudPath: preparation.objectKey, filePath: 'wxfile://usr/mip-ai-voice.mp3' })
    expect(createVoiceDraftStorage).toHaveBeenCalledWith({
      purpose: 'SUPER_CASE',
      audioAssetId: preparation.assetId,
      fileId: `cloud://env/${preparation.objectKey}`,
      contentType: 'audio/mpeg',
      contentBytes: bytes.length,
      contentSha256: sha256Hex(bytes),
      requestId: expect.stringMatching(/^ai-draft-voice-storage-/),
    })
  })

  it('rejects an upload whose returned file id does not match the allocated object key', async () => {
    const uploadFile = vi.fn(async () => ({ fileID: 'cloud://env/mip/development/other/path.mp3' }))
    const createVoiceDraftStorage = vi.fn(async () => draft)
    const flow = createVoiceNoteFlow(gateway({ createVoiceDraftStorage }), {
      cloud: { uploadFile },
      fileSystem: { readFile: () => { throw new Error('must not read') } },
    })
    await expect(flow.createVoiceDraftFromRecording('SUPER_CASE', {
      filePath: 'wxfile://usr/mip-ai-voice.mp3',
      durationMs: 1000,
      bytes: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow('录音上传结果异常')
    expect(createVoiceDraftStorage).not.toHaveBeenCalled()
  })
})

describe('module storage-channel guard', () => {
  it('validates the direct-upload intent before calling the gateway', async () => {
    const module = createMipAiModule(gateway())
    expect(() => module.createVoiceDraftStorage({
      purpose: 'SUPER_CASE',
      audioAssetId: 'not-a-uuid',
      fileId: `cloud://env/${preparation.objectKey}`,
      contentType: 'audio/mpeg',
      contentBytes: 3,
      contentSha256: 'a'.repeat(64),
    })).toThrow('录音文件信息不完整')
    expect(() => module.createVoiceDraftStorage({
      purpose: 'SUPER_CASE',
      audioAssetId: preparation.assetId,
      fileId: 'https://env/other.mp3',
      contentType: 'audio/mpeg',
      contentBytes: 3,
      contentSha256: 'a'.repeat(64),
    })).toThrow('录音文件信息不完整')
    const result = await module.createVoiceDraftStorage({
      purpose: 'SUPER_CASE',
      audioAssetId: preparation.assetId,
      fileId: `cloud://env/${preparation.objectKey}`,
      contentType: 'audio/mpeg',
      contentBytes: 3,
      contentSha256: 'a'.repeat(64),
    })
    expect(result).toEqual(draft)
  })

  it('exposes prepareVoiceUpload through the module', async () => {
    const module = createMipAiModule(gateway())
    await expect(module.prepareVoiceUpload('COOPERATION_CARD')).resolves.toMatchObject({
      contentType: 'audio/mpeg',
      maximumContentBytes: 6 * 1024 * 1024,
    })
  })
})
