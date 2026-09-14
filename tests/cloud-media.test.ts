import type { CaseCloudClient } from '../src/platform/cloudbase/client'
import { replaceCloudFileUrls } from '@weapp/platform/media-urls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCloudMediaCache,
  resolveCloudFileUrls,
} from '../src/platform/storage/cloud-media'

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(),
}))

describe('CloudBase media URLs', () => {
  afterEach(() => {
    clearCloudMediaCache()
    vi.unstubAllGlobals()
  })

  it('replaces nested cloud file IDs without mutating unrelated values', () => {
    const source = {
      avatarUrl: 'cloud://environment/avatar.webp',
      tags: ['community'],
      events: [{ coverUrl: 'cloud://environment/event.webp', title: '线下活动' }],
    }
    const result = replaceCloudFileUrls(source, new Map([
      ['cloud://environment/avatar.webp', 'https://example.test/avatar.webp'],
      ['cloud://environment/event.webp', 'https://example.test/event.webp'],
    ]))

    expect(result).toEqual({
      avatarUrl: 'https://example.test/avatar.webp',
      tags: ['community'],
      events: [{ coverUrl: 'https://example.test/event.webp', title: '线下活动' }],
    })
    expect(source.avatarUrl).toBe('cloud://environment/avatar.webp')
  })

  it('downloads CloudBase media once and returns stable process-local paths', async () => {
    const downloads: string[] = []
    const cloud = {
      callFunction: async () => ({ result: null }),
      downloadFile: async ({ fileID }: { fileID: string }) => {
        downloads.push(fileID)
        return { tempFilePath: `wxfile://tmp/${fileID.split('/').at(-1)}`, statusCode: 200, errMsg: 'downloadFile:ok' }
      },
      getTempFileURL: async () => ({ fileList: [], errMsg: 'getTempFileURL:ok' }),
    } as CaseCloudClient
    const source = {
      avatarUrl: 'cloud://media-test/member.webp',
      events: [{ coverUrl: 'cloud://media-test/event.webp' }],
    }

    await expect(resolveCloudFileUrls(source, cloud)).resolves.toEqual({
      avatarUrl: 'wxfile://tmp/member.webp',
      events: [{ coverUrl: 'wxfile://tmp/event.webp' }],
    })
    await resolveCloudFileUrls(source, cloud)
    expect(downloads).toHaveLength(2)
  })

  it('rejects storage error documents returned as successful downloads', async () => {
    const cloudDownload = vi.fn(async () => {
      return {
        tempFilePath: 'http://tmp/storage-error.xml',
        statusCode: 200,
        errMsg: 'downloadFile:ok',
      }
    })
    const getTempFileURL = vi.fn()
    const cloud = {
      callFunction: async () => ({ result: null }),
      downloadFile: cloudDownload,
      getTempFileURL,
    } as unknown as CaseCloudClient

    const result = await resolveCloudFileUrls({
      imageUrl: 'cloud://media-test/mip/app/events/id/covers/user-event.jpg',
    }, cloud)
    expect(result).toEqual({ imageUrl: '' })
    expect(cloudDownload).toHaveBeenCalledTimes(2)
    expect(getTempFileURL).not.toHaveBeenCalled()
  })

  it('does not request a signed URL when native CloudBase download succeeds', async () => {
    const cloudDownload = vi.fn(async () => ({
      tempFilePath: 'wxfile://tmp/native-event.jpg',
      statusCode: 200,
      errMsg: 'downloadFile:ok',
    }))
    const getTempFileURL = vi.fn(async () => ({ fileList: [], errMsg: 'getTempFileURL:ok' }))
    const cloud = {
      callFunction: async () => ({ result: null }),
      downloadFile: cloudDownload,
      getTempFileURL,
    } as unknown as CaseCloudClient

    const result = await resolveCloudFileUrls({ imageUrl: 'cloud://media-test/native-event.jpg' }, cloud)
    expect(result).toEqual({ imageUrl: 'wxfile://tmp/native-event.jpg' })
    expect(cloudDownload).toHaveBeenCalledWith({ fileID: 'cloud://media-test/native-event.jpg' })
    expect(getTempFileURL).not.toHaveBeenCalled()
  })
})

describe('concurrent media loading', () => {
  afterEach(() => clearCloudMediaCache())

  it('limits total native downloads across independently rendering cards', async () => {
    let active = 0
    let peak = 0
    const downloadFile = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return { tempFilePath: 'wxfile://tmp/cover.jpg' }
    })
    const cloud = { downloadFile } as unknown as CaseCloudClient
    await Promise.all(Array.from({ length: 9 }, (_, index) =>
      resolveCloudFileUrls(`cloud://test/${index}.jpg`, cloud)))
    expect(downloadFile).toHaveBeenCalledTimes(9)
    expect(peak).toBe(3)
  })

  it('shares the same avatar download between simultaneous page sections', async () => {
    let finish!: (value: { tempFilePath: string }) => void
    const downloadFile = vi.fn(() => new Promise<{ tempFilePath: string }>((resolve) => {
      finish = resolve
    }))
    const cloud = { downloadFile } as unknown as CaseCloudClient
    const source = { avatarUrl: 'cloud://media-test/shared-avatar.jpg' }
    const first = resolveCloudFileUrls(source, cloud)
    const second = resolveCloudFileUrls(source, cloud)
    expect(downloadFile).toHaveBeenCalledTimes(1)
    finish({ tempFilePath: 'wxfile://tmp/shared-avatar.jpg' })
    expect(await first).toEqual(await second)
  })

  it('does not reuse a pending image across an identity boundary', async () => {
    let finish!: (value: { tempFilePath: string }) => void
    const downloadFile = vi.fn()
      .mockImplementationOnce(() => new Promise<{ tempFilePath: string }>((resolve) => {
        finish = resolve
      }))
      .mockResolvedValue({ tempFilePath: 'wxfile://tmp/new-session.jpg' })
    const cloud = { downloadFile } as unknown as CaseCloudClient
    const source = { avatarUrl: 'cloud://media-test/shared-avatar.jpg' }
    const old = resolveCloudFileUrls(source, cloud)
    clearCloudMediaCache()
    const current = await resolveCloudFileUrls(source, cloud)
    finish({ tempFilePath: 'wxfile://tmp/old-session.jpg' })
    await old
    expect(await resolveCloudFileUrls(source, cloud)).toEqual(current)
    expect(downloadFile).toHaveBeenCalledTimes(2)
  })
})
