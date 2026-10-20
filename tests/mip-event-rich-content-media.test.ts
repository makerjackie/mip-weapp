import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearEventRichContent, updateEventRichContent } from '../src/modules/mip-events/rich-content-media'
import { resolveCloudFileUrls } from '../src/platform/storage/cloud-media'

vi.mock('../src/platform/storage/cloud-media', () => ({
  getCloudMediaGeneration: () => 0,
  resolveCloudFileUrls: vi.fn(),
}))

describe('shared event and checkout rich content', () => {
  afterEach(() => vi.resetAllMocks())

  it('renders real editor HTML as nodes and hydrates quoted or unquoted cloud images', async () => {
    const fileId = 'cloud://env.bucket/mip/staging/app/image.png'
    vi.mocked(resolveCloudFileUrls).mockResolvedValue(['https://cdn.example/image.png?sign=fresh'])
    const setData = vi.fn()
    updateEventRichContent({ setData }, 'noticesNodes', `<h2>报名前，请先了解</h2><p><strong>玩家与嘉宾</strong></p><img src='${fileId}'>`)
    expect(JSON.stringify(setData.mock.calls[0][0])).toContain('报名前，请先了解')
    expect(JSON.stringify(setData.mock.calls[0][0])).not.toContain('<h2>')
    expect(JSON.stringify(setData.mock.calls[0][0])).not.toContain('cloud://')
    await Promise.resolve()
    expect(JSON.stringify(setData.mock.lastCall?.[0])).toContain('https://cdn.example/image.png?sign=fresh')
  })

  it('does not let a slow image response overwrite new content or write after leaving the page', async () => {
    let resolveImage!: (value: unknown) => void
    vi.mocked(resolveCloudFileUrls).mockReturnValue(new Promise((resolve) => {
      resolveImage = resolve
    }) as Promise<string[]>)
    const setData = vi.fn()
    const target = { setData }
    updateEventRichContent(target, 'noticesNodes', '![旧图](cloud://env.bucket/image.png)')
    updateEventRichContent(target, 'noticesNodes', '<p>更新后的须知</p>')
    clearEventRichContent(target)
    const callsBeforeResponse = setData.mock.calls.length
    resolveImage(['https://cdn.example/old.png'])
    await Promise.resolve()
    expect(setData).toHaveBeenCalledTimes(callsBeforeResponse)
    expect(JSON.stringify(setData.mock.lastCall?.[0])).toContain('更新后的须知')
  })
})
