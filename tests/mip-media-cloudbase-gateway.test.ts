import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipMediaCloudbaseTransport } from '../src/modules/mip-media/cloudbase-gateway'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
}))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => cloudHarness),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { mediaFunctionName: 'mip-media-api' } },
}))

describe('MIP media CloudBase transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('describes a failed call as an image upload problem without exposing internal service language', async () => {
    cloudHarness.callFunction.mockRejectedValue(new Error('private transport detail'))

    const transport = createMipMediaCloudbaseTransport('mip-media-api')

    await expect(transport.invoke('uploadImage', {
      purpose: 'OPPORTUNITY_COVER',
      imageBase64: 'fixture',
    })).rejects.toThrow('图片上传暂时不可用，请稍后重试')
  })
})
