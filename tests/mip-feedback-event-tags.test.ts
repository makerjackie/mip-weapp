import { beforeAll, expect, it, vi } from 'vitest'

vi.mock('../src/platform/storage/component-media', () => ({ clearComponentMedia: vi.fn(), updateComponentMedia: vi.fn() }))
vi.mock('../src/platform/wechat/channels', () => ({ openWechatChannelsDestination: vi.fn() }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Component', (value: unknown) => {
    definition = value
  })
  await import('../src/components/mip-activity-card/index')
})
it('uses configured tags in place of the legacy type while retaining legacy-only events and status', () => {
  const data: Record<string, unknown> = {}
  const instance = { setData: (patch: unknown) => Object.assign(data, patch) }
  definition.observers.event.call(instance, { tags: ['早会', '早会', '已报名'], eventTypeLabel: 'MIP早会', statusLabel: '已报名' })
  expect(data).toMatchObject({ displayTags: ['早会'], displayEventType: '' })
  definition.observers.event.call(instance, { tags: [], eventTypeLabel: 'MIP早会' })
  expect(data).toMatchObject({ displayTags: [], displayEventType: 'MIP早会' })
})
