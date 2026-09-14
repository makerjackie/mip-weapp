import type { InboxMessage, InboxMessagePage } from '../src/modules/mip-messaging/types'
import { createRequire } from 'node:module'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipMessagingGateway } from '../src/modules/mip-messaging/gateway'
import { createMipMessagingModule } from '../src/modules/mip-messaging/module'

const harness = vi.hoisted(() => ({ module: undefined as unknown }))
vi.mock('../src/modules/mip-messaging/client', () => ({ get mipMessagingModule() {
  return harness.module
} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))
const require = createRequire(import.meta.url)
const { createNotificationsRepository } = require('../cloudfunctions/mip-notifications-api/domain/repository.js')

interface TestPage {
  data: { items: InboxMessage[], unreadCount: number, state: string, message: string, loadingMore: boolean }
  setData: (patch: Record<string, unknown>) => void
  loadInbox: (force?: boolean) => Promise<void>
  loadMore: () => Promise<void>
  onReachBottom: () => void
  markAllRead: () => Promise<void>
  openMessage: (event: unknown) => Promise<void>
}
let definition: TestPage
let module: ReturnType<typeof createMipMessagingModule>
let rows: Record<string, unknown>[]
let failWrite = false
const invoke = vi.fn()
function page() {
  return { ...definition, data: structuredClone(definition.data), setData(patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  } }
}
beforeAll(async () => {
  vi.stubGlobal('Page', (value: TestPage) => {
    definition = value
  })
  await import('../src/packages/member/mip-notifications/index')
  vi.unstubAllGlobals()
})
beforeEach(() => {
  failWrite = false
  rows = Array.from({ length: 23 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`,
    recipient_user_id: '10000000-0000-4000-8000-000000000001',
    message_type: 'EVENT',
    title: `通知 ${index + 1}`,
    body: '活动即将开始',
    read_at: null,
    created_at: '2026-09-14T00:00:00.000Z',
  }))
  const repository = createNotificationsRepository({
    query: async (_sql: string, params: unknown[]) => {
      const filtered = params.length > 3 ? rows.filter(row => String(row.id) < String(params[4])) : rows
      return filtered.slice(0, Number(params.at(-1)))
    },
    one: async () => ({ count: rows.filter(row => !row.read_at).length }),
  })
  invoke.mockReset().mockImplementation(async (request) => {
    if (request.action === 'listInbox') {
      return {
        ok: true,
        data: await repository.listInbox('app', 'user', request.input),
      }
    }
    if (failWrite) {
      throw new Error('offline')
    }
    const readAt = '2026-09-14T01:00:00.000Z'
    rows.forEach((row) => {
      if (!row.read_at && (request.action === 'markAllRead' || row.id === request.input.messageId)) {
        row.read_at = readAt
      }
    })
    return { ok: true, data: { readAt, messageId: request.input.messageId } }
  })
  module = createMipMessagingModule(createMipMessagingGateway({ invoke }), { capability: templateKey => ({ templateKey, available: false }), request: async () => 'REJECTED' })
  harness.module = module
})
describe('inbox repository to page contract', () => {
  it('renders 20 real DTOs after badge refresh, then automatically loads the remaining messages', async () => {
    await module.refreshUnreadCount()
    const p = page()
    await p.loadInbox()
    expect(p.data.items).toHaveLength(20)
    expect(p.data.items[0]).toMatchObject({ title: '通知 1', body: '活动即将开始', createdText: expect.any(String) })
    p.onReachBottom()
    await vi.waitFor(() => expect(p.data.items).toHaveLength(23))
    await p.openMessage({ currentTarget: { dataset: { id: p.data.items[22].id } } })
    expect(module.peekUnreadCount()).toBe(22)
    expect(p.data.unreadCount).toBe(22)
  })
  it('does not reuse a smaller first page for a normal inbox request', async () => {
    await module.listInbox(undefined, { limit: 1 })
    expect((await module.listInbox()).items).toHaveLength(20)
  })
  it('marks unloaded messages too and persists zero unread after a fresh load', async () => {
    const p = page()
    await p.loadInbox()
    await p.markAllRead()
    expect(rows.every(row => row.read_at)).toBe(true)
    expect(p.data.items.every(item => item.readAt)).toBe(true)
    expect(module.peekUnreadCount()).toBe(0)
    expect(invoke).toHaveBeenCalledWith({ contractVersion: 1, action: 'markAllRead', input: {} })
    await p.loadInbox(true)
    expect(p.data.unreadCount).toBe(0)
  })
  it('preserves unread state on bulk write failure', async () => {
    const p = page()
    await p.loadInbox()
    failWrite = true
    await p.markAllRead()
    expect(p.data.unreadCount).toBe(23)
    expect(module.peekUnreadCount()).toBe(23)
    expect(p.data.message).toContain('失败')
  })
  it('ignores an old count response after marking all read', async () => {
    await module.listInbox()
    let resolve!: (value: unknown) => void
    invoke.mockImplementationOnce(() => new Promise((r) => {
      resolve = r
    }))
    const oldRead = module.refreshUnreadCount({ force: true })
    await module.markAllRead()
    resolve({ ok: true, data: { items: [], unreadCount: 23 } satisfies InboxMessagePage })
    await expect(oldRead).resolves.toBe(0)
    expect(module.peekUnreadCount()).toBe(0)
  })
})
