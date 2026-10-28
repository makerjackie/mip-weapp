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
it('renders exactly configured labels and fixed colors even when a label matches a former automatic chip', () => {
  const data: Record<string, unknown> = {}
  const instance = { setData: (patch: unknown) => Object.assign(data, patch) }
  definition.observers.event.call(instance, { tags: ['test', 'test', '玩家免费'], tagStyles: [{ name: 'test', backgroundColor: '#ff4d5e', textColor: '#ffffff' }], eventTypeLabel: 'MIP早会', accessLabel: '玩家免费', statusLabel: '已报名' })
  expect(data.displayTags).toEqual([{ name: 'test', backgroundColor: '#ff4d5e', textColor: '#ffffff' }, { name: '玩家免费', backgroundColor: '#7acbff', textColor: '#000000' }])
  definition.observers.event.call(instance, { tags: [], eventTypeLabel: 'MIP早会', accessLabel: '玩家免费' })
  expect(data.displayTags).toEqual([])
})
