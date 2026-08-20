import type { CaseCloudClient } from '../src/modules/platform/cloudbase'
import { replaceCloudFileUrls } from '@weapp/platform/media-urls'
import { describe, expect, it, vi } from 'vitest'
import {
  appendCloudImageTransform,
  cloudImageTransformForFileId,
  resolveCloudFileUrls,
} from '../src/modules/platform/cloud-media'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

describe('CloudBase media URLs', () => {
  it('selects bounded CloudBase image variants without changing original object IDs', () => {
    expect(cloudImageTransformForFileId('cloud://env/member-assets/app/avatars/user/a.jpg'))
      .toContain('thumbnail/320x320')
    expect(cloudImageTransformForFileId('cloud://env/member-assets/app/events/id/covers/a.jpg'))
      .toContain('thumbnail/1200x')
    expect(cloudImageTransformForFileId('cloud://env/member-assets/app/events/id/album/a.jpg'))
      .toContain('thumbnail/1600x')
    expect(appendCloudImageTransform(
      'https://example.test/file.jpg?sign=1',
      'imageMogr2/thumbnail/1200x',
    )).toBe('https://example.test/file.jpg?sign=1&imageMogr2/thumbnail/1200x')
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
})
