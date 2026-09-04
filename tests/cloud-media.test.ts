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
