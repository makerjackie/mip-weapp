import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, listComments, beginProtectedAction } = vi.hoisted(() => ({
  get: vi.fn(),
  listComments: vi.fn(),
  beginProtectedAction: vi.fn(),
}))
vi.mock('../src/modules/mip-opportunities', async () => {
  const { journeyStatusOf } = await import('../src/modules/mip-opportunities/catalog')
  return {
    opportunityModule: { get, listComments },
    journeyStatusOf,
    opportunityTypeLabel: vi.fn(),
    retainOpportunityCommentReportIntent: vi.fn(),
    retainOpportunityCommentSubmissionIntent: vi.fn(),
  }
})
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { beginProtectedAction } }))

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/mip-opportunities/detail/index')
})
beforeEach(() => {
  vi.clearAllMocks()
  listComments.mockResolvedValue({
    items: [{ id: 'comment-1', body: '合作体验很好', author: { nickname: '玩家' }, createdAt: '2026-09-26T10:00:00Z' }],
    settings: { commentsEnabled: true, reviewsEnabled: true },
  })
})
function page() {
  return Object.assign(Object.create(definition), {
    data: { ...structuredClone(definition.data), id: 'opportunity-1' },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}
function opportunity(status: string) {
  return { id: 'opportunity-1', status, mine: true, canEdit: true, title: '合作机会', roles: [], description: '正文仍可读' }
}

describe('opportunity public comment visibility', () => {
  it.each(['DRAFT', 'UNPUBLISHED', 'ARCHIVED'])('does not request comments or identity completion for %s content', async (status) => {
    const item = opportunity(status)
    get.mockResolvedValue(item)
    const p = page()
    await p.load()
    await p.loadComments(true)
    await p.authorizeInteraction('comment')
    expect(listComments).not.toHaveBeenCalled()
    expect(beginProtectedAction).not.toHaveBeenCalled()
    expect(p.data.commentsAvailable).toBe(false)
    expect(p.data.state).toBe('ready')
    expect(p.data.item).toEqual(item)
    if (status === 'UNPUBLISHED') {
      expect(p.data.ownerBar).toBe('unpublished')
    }
  })

  it.each(['PUBLISHED', 'ENDED'])('loads nonempty comments for %s content', async (status) => {
    get.mockResolvedValue(opportunity(status))
    const p = page()
    await p.load()
    expect(listComments).toHaveBeenCalledWith('opportunity-1', undefined)
    expect(p.data.commentsAvailable).toBe(true)
    expect(p.data.commentsState).toBe('ready')
    expect(p.data.comments[0]).toMatchObject({ id: 'comment-1', body: '合作体验很好', authorInitial: '玩' })
  })

  it('clears the public comment composer when a published opportunity becomes unpublished', async () => {
    const p = page()
    get.mockResolvedValueOnce(opportunity('PUBLISHED')).mockResolvedValueOnce(opportunity('UNPUBLISHED'))
    await p.load()
    p.data.composerVisible = true
    p.data.commentsMessage = '先前的错误'
    await p.load()
    expect(listComments).toHaveBeenCalledTimes(1)
    expect(p.data.commentsAvailable).toBe(false)
    expect(p.data.comments).toEqual([])
    expect(p.data.commentsMessage).toBe('')
    expect(p.data.commentSettings).toBeNull()
    expect(p.data.composerVisible).toBe(false)
    const view = readFileSync(new URL('../src/packages/member/mip-opportunities/detail/index.wxml', import.meta.url), 'utf8')
    expect(view).toContain('wx:if="{{commentsAvailable}}" id="opportunity-comments"')
    expect(view).toContain('aria-disabled="true" disabled>分享机会</button>')
  })
})
