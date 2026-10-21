import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireCloudClient } from '../src/platform/cloudbase/client'
import { clearCloudMediaCache } from '../src/platform/storage/cloud-media'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))

interface Definition { data: Record<string, unknown>, [key: string]: unknown }
const definitions: Definition[] = []
const callFunction = vi.fn()
const downloadFile = vi.fn()
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
function page(definition: Definition) {
  const instance = Object.create(definition) as Definition
  instance.data = structuredClone(definition.data)
  instance.data.id = 'record'
  instance.setData = (patch: Record<string, unknown>) => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.replaceAll('[', '.').replaceAll(']', '').split('.')
      let parent = instance.data
      for (const key of keys.slice(0, -1)) {
        parent = parent[key] as Record<string, unknown>
      }
      parent[keys.at(-1)!] = value
    }
  }
  return instance
}
function call(instance: Definition, method: string) {
  return Reflect.apply(instance[method] as () => Promise<void>, instance, [])
}
function payload(kind: number, marker: string) {
  const author = { nickname: marker, avatarUrl: `cloud://slow/${marker}-avatar.png`, badge: { imageUrl: `cloud://slow/${marker}-badge.png` } }
  const common = { id: 'record', status: 'PUBLISHED', mine: true, canEdit: true, version: 7, publishedAt: '2026-10-21T00:00:00Z', author }
  return kind === 0
    ? { ...common, title: marker, description: '正文', roles: [], avatars: [author.avatarUrl], coverUrl: `cloud://slow/${marker}-cover.png` }
    : kind === 1
      ? { ...common, projectName: marker, projects: [{ projectName: marker, startedOn: '2026-10-21', description: '项目正文' }], media: [{ url: `cloud://slow/${marker}-case.png`, caption: '图片说明' }] }
      : { ...common, roleKey: 'PLANNER', positioning: marker, targetSummary: '合作目标', abilityScores: {}, roleFields: { support: '引荐需求' } }
}
beforeAll(async () => {
  vi.stubGlobal('wx', { setNavigationBarTitle: vi.fn(), nextTick: vi.fn() })
  vi.stubGlobal('Page', (definition: Definition) => {
    definitions.push(definition)
  })
  await import('../src/packages/member/mip-opportunities/detail/index')
  await import('../src/packages/member/mip-cases/detail/index')
  await import('../src/packages/member/mip-cooperation/detail/index')
})
beforeEach(() => {
  clearCloudMediaCache()
  callFunction.mockReset()
  downloadFile.mockReset().mockResolvedValue({ tempFilePath: '/tmp/cached.png' })
  vi.mocked(requireCloudClient).mockResolvedValue({ callFunction, downloadFile } as never)
})
describe.each(['opportunity', 'case', 'cooperation'])('%s detail from cloud envelope to page', (name) => {
  const index = ['opportunity', 'case', 'cooperation'].indexOf(name)
  it('shows nonempty business data while image downloads are pending, then hydrates only image fields', async () => {
    const image = deferred<{ tempFilePath: string }>()
    downloadFile.mockReturnValue(image.promise)
    callFunction.mockResolvedValue({ result: { ok: true, data: payload(index, name) } })
    const instance = page(definitions[index])
    await call(instance, 'load')
    expect(instance.data.state).toBe('ready')
    expect(instance.data.item).toMatchObject({ id: 'record', version: 7, canEdit: true })
    expect(JSON.stringify(instance.data.item)).toContain(name)
    expect(JSON.stringify(instance.data)).not.toContain('cloud://')
    expect(downloadFile).toHaveBeenCalled()
    // A late image must not overwrite a newer business fact or an unsaved interaction.
    ;(instance.data.item as Record<string, unknown>).version = 8
    image.resolve({ tempFilePath: '/tmp/downloaded.png' })
    await vi.waitFor(() => expect(JSON.stringify(instance.data)).toContain('/tmp/downloaded.png'))
    expect(instance.data.item).toMatchObject({ version: 8 })
    if (index === 1) {
      expect(instance.data.mediaUrls).toEqual(['/tmp/downloaded.png'])
      expect(instance.data.item).toMatchObject({ media: [{ url: '/tmp/downloaded.png', caption: '图片说明' }] })
    }
  })
  it('ignores a stale response after reload and after leaving the page', async () => {
    const old = deferred<unknown>()
    callFunction.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ result: { ok: true, data: payload(index, `new-${name}`) } })
    const instance = page(definitions[index])
    const first = call(instance, 'load')
    await vi.waitFor(() => expect(callFunction).toHaveBeenCalledOnce())
    await call(instance, 'load')
    old.resolve({ result: { ok: true, data: payload(index, `old-${name}`) } })
    await first
    expect(JSON.stringify(instance.data.item)).toContain(`new-${name}`)
    expect(JSON.stringify(instance.data.item)).not.toContain(`old-${name}`)
    const leaving = deferred<unknown>()
    callFunction.mockReturnValueOnce(leaving.promise)
    const last = call(instance, 'load')
    await call(instance, 'onUnload')
    const snapshot = structuredClone(instance.data)
    leaving.resolve({ result: { ok: true, data: payload(index, `left-${name}`) } })
    await last
    expect(instance.data).toEqual(snapshot)
  })
})
