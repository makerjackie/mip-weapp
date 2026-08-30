import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const adminMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAnnouncements: vi.fn(),
}))
const messagingMocks = vi.hoisted(() => ({
  listInbox: vi.fn(),
  markRead: vi.fn(),
}))
const runtimeMocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  showModal: vi.fn(),
}))

vi.mock('../src/modules/mip-admin', () => ({
  hasCapability: () => true,
  mipAdminModule: {
    getSession: adminMocks.getSession,
    messaging: {
      listAnnouncements: adminMocks.listAnnouncements,
    },
  },
}))
vi.mock('../src/modules/mip-messaging', () => ({
  isTrustedInboxRoute: () => true,
}))
vi.mock('../src/modules/mip-messaging/client', () => ({
  mipMessagingModule: {
    listInbox: messagingMocks.listInbox,
    markRead: messagingMocks.markRead,
    peekInbox: vi.fn(),
    subscriptionCapability: vi.fn(() => ({ available: false })),
  },
}))
vi.mock('../src/modules/platform/case-navigation', () => ({
  caseNavigateTo: runtimeMocks.navigateTo,
}))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let capturedPage: PageDefinition
let announcementPage: PageDefinition
let notificationPage: PageDefinition

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createPage(definition: PageDefinition) {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown> | void
}

function announcement(id: string, status: 'DRAFT' | 'PUBLISHED') {
  return {
    id,
    title: id,
    scopeType: 'PLATFORM',
    branchName: '',
    status,
    contentSafetyStatus: 'PASSED',
    updatedAt: '2026-08-30T00:00:00.000Z',
  }
}

function inboxMessage(id: string) {
  return {
    id,
    title: id,
    body: id,
    messageType: 'OPERATIONS',
    readAt: null,
    createdAt: '2026-08-30T00:00:00.000Z',
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showModal: runtimeMocks.showModal })
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    capturedPage = definition
  })
  await import('../src/packages/admin/announcements/index')
  announcementPage = capturedPage
  await import('../src/packages/member/mip-notifications/index')
  notificationPage = capturedPage
})

beforeEach(() => {
  adminMocks.getSession.mockReset().mockResolvedValue({ capabilities: [{}] })
  adminMocks.listAnnouncements.mockReset()
  messagingMocks.listInbox.mockReset()
  messagingMocks.markRead.mockReset()
  runtimeMocks.navigateTo.mockReset().mockResolvedValue(undefined)
  runtimeMocks.showModal.mockReset()
})

describe('client page request ordering', () => {
  it('keeps the newest admin announcement filter when an older response finishes last', async () => {
    const older = deferred<{ items: ReturnType<typeof announcement>[], nextCursor: null }>()
    const newer = deferred<{ items: ReturnType<typeof announcement>[], nextCursor: null }>()
    adminMocks.listAnnouncements.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const page = createPage(announcementPage)

    page.data.status = 'DRAFT'
    const olderRun = callPage(page, 'loadItems', true) as Promise<unknown>
    await Promise.resolve()
    page.data.status = 'PUBLISHED'
    const newerRun = callPage(page, 'loadItems', true) as Promise<unknown>
    await Promise.resolve()
    newer.resolve({ items: [announcement('newer', 'PUBLISHED')], nextCursor: null })
    await newerRun
    older.resolve({ items: [announcement('older', 'DRAFT')], nextCursor: null })
    await olderRun

    expect(page.data.status).toBe('PUBLISHED')
    expect(page.data.items).toEqual([expect.objectContaining({ id: 'newer' })])
  })

  it('does not open two announcement confirmations before the first one settles', async () => {
    const confirmation = deferred<{ confirm: boolean }>()
    runtimeMocks.showModal.mockReturnValue(confirmation.promise)
    const page = createPage(announcementPage)
    page.data.items = [announcement('announcement-1', 'DRAFT')]
    const event = { currentTarget: { dataset: { id: 'announcement-1', transition: 'PUBLISH' } } }

    const first = callPage(page, 'transition', event) as Promise<unknown>
    await callPage(page, 'transition', event)
    expect(runtimeMocks.showModal).toHaveBeenCalledOnce()
    confirmation.resolve({ confirm: false })
    await first
  })

  it('drops a superseded inbox append and latches unread message opening', async () => {
    const append = deferred<{ items: ReturnType<typeof inboxMessage>[], unreadCount: number, nextCursor: string }>()
    const refresh = deferred<{ items: ReturnType<typeof inboxMessage>[], unreadCount: number, nextCursor: string }>()
    messagingMocks.listInbox.mockReturnValueOnce(append.promise).mockReturnValueOnce(refresh.promise)
    const page = createPage(notificationPage)
    page.data.items = [inboxMessage('cached')]
    page.data.nextCursor = 'old-cursor'

    const appendRun = callPage(page, 'loadMore') as Promise<unknown>
    const refreshRun = callPage(page, 'loadInbox', true) as Promise<unknown>
    refresh.resolve({ items: [inboxMessage('fresh')], unreadCount: 1, nextCursor: '' })
    await refreshRun
    append.resolve({ items: [inboxMessage('stale-append')], unreadCount: 2, nextCursor: '' })
    await appendRun
    expect(page.data.items).toEqual([expect.objectContaining({ id: 'fresh' })])

    const read = deferred<{ readAt: string }>()
    messagingMocks.markRead.mockReturnValue(read.promise)
    const event = { currentTarget: { dataset: { id: 'fresh' } } }
    const firstOpen = callPage(page, 'openMessage', event) as Promise<unknown>
    await callPage(page, 'openMessage', event)
    expect(messagingMocks.markRead).toHaveBeenCalledOnce()
    read.resolve({ readAt: '2026-08-30T01:00:00.000Z' })
    await firstOpen
    expect(page.data.unreadCount).toBe(0)
  })
})

describe('client stability source contracts', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

  it('safely decodes invitation query values', () => {
    for (const file of [
      'src/packages/member/mip-events/detail/index.ts',
      'src/packages/member/mip-events/registration/index.ts',
    ]) {
      const page = source(file)
      expect(page).toContain('function decodeInvitationToken')
      expect(page).toMatch(/try \{[\s\S]*?decodeURIComponent\(value\)[\s\S]*?catch \{/)
      expect(page).not.toContain('query.invitationToken ? decodeURIComponent(query.invitationToken)')
    }
  })

  it('invalidates refresh and pagination work by request generation', () => {
    const tasks = source('src/packages/member/mip-tasks/index.ts')
    const opportunities = source('src/packages/member/mip-opportunities/mine/index.ts')
    expect(tasks).toContain('requestSeq: 0')
    expect(tasks).toMatch(/if \(seq !== this\.requestSeq\)/)
    expect(opportunities).toContain('publishedRequestSeq: 0')
    expect(opportunities).toContain('referredRequestSeq: 0')
    expect(opportunities).toMatch(/if \(sequence !== this\.publishedRequestSeq\)/)
    expect(opportunities).toMatch(/if \(sequence !== this\.referredRequestSeq\)/)
  })

  it('clears every delayed editor navigation on hide and unload', () => {
    for (const file of [
      'src/packages/admin/announcement-editor/index.ts',
      'src/packages/admin/banner-editor/index.ts',
      'src/packages/member/mip-profile/index.ts',
      'src/packages/member/mip-card-edit/index.ts',
      'src/packages/member/mip-cases/editor/index.ts',
      'src/packages/member/mip-opportunities/editor/index.ts',
      'src/packages/member/mip-cooperation/editor/index.ts',
    ]) {
      const page = source(file)
      expect(page).toContain('navigationTimer: undefined')
      expect(page).toMatch(/onHide\(\)[\s\S]{0,80}clearNavigationTimer/)
      expect(page).toMatch(/onUnload\(\)[\s\S]{0,80}clearNavigationTimer/)
    }
  })
})
