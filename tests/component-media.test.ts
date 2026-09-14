import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireCloudClient } from '../src/platform/cloudbase/client'
import { clearCloudMediaCache } from '../src/platform/storage/cloud-media'
import { clearComponentMedia, updateComponentMedia } from '../src/platform/storage/component-media'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))

function deferred() {
  let resolve!: (value: { tempFilePath: string }) => void
  const promise = new Promise<{ tempFilePath: string }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('progressive card media', () => {
  afterEach(() => clearCloudMediaCache())

  it('keeps text visible and hydrates a cover while another image is still pending', async () => {
    const cover = deferred()
    const avatar = deferred()
    const downloadFile = vi.fn(({ fileID }: { fileID: string }) => fileID.includes('cover') ? cover.promise : avatar.promise)
    vi.mocked(requireCloudClient).mockResolvedValue({ downloadFile } as never)
    const data: Record<string, unknown> = { title: '活动标题' }
    const target = { setData: (patch: Record<string, unknown>) => Object.assign(data, patch) }
    updateComponentMedia(target, 'cover', 'cloud://test/cover.jpg')
    updateComponentMedia(target, 'avatars', [{ avatarUrl: 'cloud://test/avatar.jpg' }])
    expect(data).toEqual({ title: '活动标题', cover: '', avatars: [{ avatarUrl: '' }] })
    cover.resolve({ tempFilePath: 'wxfile://cover.jpg' })
    await vi.waitFor(() => expect(data.cover).toBe('wxfile://cover.jpg'))
    expect(data.avatars).toEqual([{ avatarUrl: '' }])
    avatar.resolve({ tempFilePath: 'wxfile://avatar.jpg' })
    await vi.waitFor(() => expect(data.avatars).toEqual([{ avatarUrl: 'wxfile://avatar.jpg' }]))
  })

  it('ignores stale results after card reuse and detach', async () => {
    const old = deferred()
    const next = deferred()
    vi.mocked(requireCloudClient).mockResolvedValue({
      downloadFile: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise),
    } as never)
    const target = { setData: vi.fn() }
    updateComponentMedia(target, 'cover', 'cloud://test/old.jpg')
    await vi.waitFor(() => expect(requireCloudClient).toHaveBeenCalled())
    updateComponentMedia(target, 'cover', 'cloud://test/next.jpg')
    clearComponentMedia(target)
    target.setData.mockClear()
    old.resolve({ tempFilePath: 'wxfile://old.jpg' })
    next.resolve({ tempFilePath: 'wxfile://next.jpg' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(target.setData).not.toHaveBeenCalled()
  })
})
