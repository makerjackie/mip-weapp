import type { MipKnowledgeGateway } from '../src/modules/mip-knowledge/gateway'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipKnowledgeModule } from '../src/modules/mip-knowledge/module'

const client = vi.hoisted(() => ({ mipKnowledgeModule: {} as Record<string, unknown> }))
vi.mock('../src/modules/mip-knowledge/client', () => client)
vi.mock('../src/modules/mip-community', () => ({ reportCategoryOptions: [] }))
vi.mock('../src/modules/mip-identity', () => ({}))
vi.mock('../src/modules/mip-identity/client', () => ({}))
vi.mock('../src/platform/navigation/client', () => ({}))

type Data = Record<string, unknown>
interface Definition { data: Data, [key: string]: unknown }
let definition: Definition
function page() {
  const value = Object.create(definition) as Definition & { setData: (patch: Data) => void }
  value.data = structuredClone(definition.data)
  value.setData = patch => Object.assign(value.data, patch)
  value.data.contentId = 'content-1'
  return value
}
async function call(value: Definition, name: string) {
  await Reflect.apply(value[name] as () => Promise<void>, value, [])
}
const getContent = vi.fn()
const listComments = vi.fn()
const createComment = vi.fn()
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    definition = value
  })
  await import('../src/packages/member/mip-knowledge/detail/index')
})
beforeEach(() => {
  vi.stubGlobal('wx', { showToast: vi.fn() })
  getContent.mockReset().mockResolvedValue({ access: { unlocked: true } })
  listComments.mockReset().mockResolvedValue({ items: [], settings: { commentsEnabled: true } })
  createComment.mockReset()
  let sequence = 0
  client.mipKnowledgeModule = createMipKnowledgeModule({ getContent, listComments, createComment } as unknown as MipKnowledgeGateway, { payOrder: vi.fn() }, { paymentEnabled: true, createRequestId: () => `request-${++sequence}` })
})
describe('knowledge detail recovery', () => {
  it('replays the committed comment after response loss, but creates a new intent after success', async () => {
    const committed = new Set<string>()
    let loseResponse = true
    createComment.mockImplementation(async (intent) => {
      committed.add(intent.idempotencyKey)
      if (loseResponse) {
        loseResponse = false
        throw new Error('response lost')
      }
      return { id: 'comment-1', status: 'PUBLISHED', version: 1 }
    })
    const value = page()
    value.data.commentBody = 'hello'
    await call(value, 'submitComment')
    expect(value.data.commentBody).toBe('hello')
    await call(value, 'submitComment')
    expect(committed.size).toBe(1)
    expect(value.data.commentBody).toBe('')
    value.data.commentBody = 'hello'
    await call(value, 'submitComment')
    expect(committed.size).toBe(2)
  })
  it('creates a new intent for edited text after an unsuccessful attempt', async () => {
    createComment.mockRejectedValueOnce(new Error('network')).mockResolvedValue({})
    const value = page()
    value.data.commentBody = 'first'
    await call(value, 'submitComment')
    value.data.commentBody = 'edited'
    await call(value, 'submitComment')
    expect(createComment.mock.calls[0][0].idempotencyKey).not.toBe(createComment.mock.calls[1][0].idempotencyKey)
  })
  it('loads comments beyond the first page, preserving the cursor on failure', async () => {
    const first = Array.from({ length: 20 }, (_, index) => ({ id: `comment-${index}` }))
    listComments.mockResolvedValueOnce({ items: first, nextCursor: '20', settings: { commentsEnabled: true } })
    const value = page()
    await call(value, 'load')
    listComments.mockRejectedValueOnce(new Error('network'))
    await call(value, 'loadMoreComments')
    expect(value.data.commentsNextCursor).toBe('20')
    expect(value.data.comments).toHaveLength(20)
    listComments.mockResolvedValueOnce({ items: [{ id: 'comment-20' }], settings: { commentsEnabled: true } })
    await call(value, 'loadMoreComments')
    expect(listComments).toHaveBeenLastCalledWith('content-1', '20')
    expect(value.data.comments).toHaveLength(21)
    expect(value.data.commentsNextCursor).toBe('')
  })
  it('blocks pagination during refresh and resumes after returning from a hidden page', async () => {
    const value = page()
    value.data.commentsNextCursor = '20'
    let resolve!: (value: unknown) => void
    listComments.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    }))
    const refresh = call(value, 'load')
    await call(value, 'loadMoreComments')
    expect(listComments).toHaveBeenCalledTimes(1)
    expect(value.data.refreshingComments).toBe(true)
    await call(value, 'onHide')
    listComments.mockResolvedValueOnce({ items: [{ id: 'fresh' }], nextCursor: '20', settings: { commentsEnabled: true } })
    await call(value, 'load')
    resolve({ items: [{ id: 'stale' }], settings: { commentsEnabled: true } })
    await refresh
    expect(value.data.refreshingComments).toBe(false)
    listComments.mockResolvedValueOnce({ items: [{ id: 'next' }], settings: { commentsEnabled: true } })
    await call(value, 'loadMoreComments')
    expect(value.data.comments).toEqual([{ id: 'fresh' }, { id: 'next' }])
  })
  it('ignores an old pagination response after refresh', async () => {
    const value = page()
    value.data.commentsNextCursor = '20'
    let resolve!: (value: unknown) => void
    listComments.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    }))
    const pending = call(value, 'loadMoreComments')
    await call(value, 'load')
    resolve({ items: [{ id: 'stale' }], nextCursor: '40' })
    await pending
    expect(value.data.comments).toEqual([])
    expect(value.data.commentsNextCursor).toBe('')
  })
})
