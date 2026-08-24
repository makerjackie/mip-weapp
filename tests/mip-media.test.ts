import type { MipMediaGateway } from '../src/modules/mip-media/types'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createMipMediaModule } from '../src/modules/mip-media/module'

describe('MIP media client boundary', () => {
  it('submits only a declared purpose and bounded base64 payload through the gateway', async () => {
    const uploadImage = vi.fn(async (purpose, _imageBase64) => ({
      assetId: '22222222-2222-4222-8222-222222222222',
      purpose,
      imageUrl: '/tmp/mip-image.png',
      width: 96,
      height: 96,
    })) satisfies MipMediaGateway['uploadImage']
    const module = createMipMediaModule({ uploadImage })
    const result = await module.uploadImageBase64('AVATAR', Buffer.alloc(64).toString('base64'))
    expect(uploadImage).toHaveBeenCalledWith('AVATAR', expect.any(String))
    expect(result.assetId).toBe('22222222-2222-4222-8222-222222222222')

    await module.uploadImageBase64('EVENT_ALBUM', Buffer.alloc(64).toString('base64'))
    expect(uploadImage).toHaveBeenLastCalledWith('EVENT_ALBUM', expect.any(String))
  })

  it('rejects a client payload larger than the server envelope before transport', async () => {
    const uploadImage = vi.fn() as unknown as MipMediaGateway['uploadImage']
    const module = createMipMediaModule({ uploadImage })
    await expect(
      module.uploadImageBase64('SUPER_CASE_MEDIA', 'A'.repeat(1_500_000)),
    ).rejects.toThrow('图片过大')
    expect(uploadImage).not.toHaveBeenCalled()
  })

  it('rejects an undeclared purpose before compression or transport', async () => {
    const uploadImage = vi.fn() as unknown as MipMediaGateway['uploadImage']
    const module = createMipMediaModule({ uploadImage })
    await expect(
      module.uploadImageBase64('PROFILE_PHOTO' as never, 'AAAA'),
    ).rejects.toThrow('素材用途无效')
    expect(uploadImage).not.toHaveBeenCalled()
  })
})
