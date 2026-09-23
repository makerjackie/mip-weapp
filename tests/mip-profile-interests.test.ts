import { createRequire } from 'node:module'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipOpportunityError } from '../src/modules/mip-opportunities/error'
import { parseProfileInterests } from '../src/modules/mip-opportunities/profile-interests'

const { list, navigate } = vi.hoisted(() => ({ list: vi.fn(), navigate: vi.fn() }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { listProfileInterests: list }, MipOpportunityError }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigate }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/mip-profile-interests/index')
})
beforeEach(() => {
  list.mockReset()
  navigate.mockReset()
})
function page() {
  const result = Object.create(definition)
  result.data = structuredClone(definition.data)
  result.setData = (patch: Record<string, unknown>) => Object.assign(result.data, patch)
  result.onLoad({ profileRef: 'p1.target' })
  return result
}

const require = createRequire(import.meta.url)
const { listPublicProfileInterests } = require('../cloudfunctions/mip-opportunities-api/domain/profile-influence')
const { createProfileRef } = require('../cloudfunctions/mip-opportunities-api/lib/profile-ref')

describe('profile interest roster contract', () => {
  it('shows a non-empty real server DTO after parsing and opens the selected public profile', async () => {
    const appId = 'wx-roster-contract'
    const owner = '10000000-0000-4000-8000-000000000001'
    const actor = '20000000-0000-4000-8000-000000000001'
    const pepper = 'roster-contract-test-secret-with-more-than-32-characters'
    const caller = { appId, userId: owner, profileRefSecret: pepper }
    const response = await listPublicProfileInterests({
      one: async (sql: string) => sql.includes('FROM mip_users target') ? { visibility_json: {}, viewer_is_player: 0 } : { count: 1 },
      query: async () => [{ actor_user_id: actor, actor_nickname: 'Ame', actor_headline: '设计', is_player: 1, updated_at: '2026-09-22T02:30:00.000Z', actor_visibility_json: {} }],
    }, caller, { profileRef: createProfileRef({ appId, userId: owner }, pepper) })
    list.mockResolvedValue(parseProfileInterests(response))
    const p = page()
    await p.load()
    expect(p.data.state).toBe('ready')
    expect(p.data.people[0]).toMatchObject({ nickname: 'Ame', headline: '设计', userKind: 'PLAYER' })
    expect(p.data.totalCount).toBe(1)
    p.openProfile({ currentTarget: { dataset: { profileRef: p.data.people[0].profileRef } } })
    expect(navigate).toHaveBeenCalledWith({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(p.data.people[0].profileRef)}` })
  })
  it('rejects malformed list fields and strips private data', () => {
    const person = { profileRef: 'p1.person', nickname: 'Ame', userKind: 'PLAYER', interestedAt: '2026-09-22T02:30:00Z', phone: 'private', openid: 'private' }
    expect(parseProfileInterests({ items: [person], totalCount: 1 }).items[0]).not.toHaveProperty('phone')
    expect(() => parseProfileInterests({ items: [{ ...person, interestedAt: '' }], totalCount: 1 })).toThrow('格式不正确')
    expect(() => parseProfileInterests({ items: [person], totalCount: '1' })).toThrow('格式不正确')
  })
  it('keeps loaded content on a pagination failure and retries the same cursor', async () => {
    const first = parseProfileInterests({ items: [{ profileRef: 'p1.first', nickname: 'Ame', userKind: 'PLAYER', interestedAt: '2026-09-22T02:30:00Z' }], totalCount: 2, nextCursor: 'cursor' })
    list.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ ...first, nextCursor: undefined })
    const p = page()
    await p.load()
    await p.loadMore()
    expect(p.data.state).toBe('ready')
    expect(p.data.people).toHaveLength(1)
    expect(p.data.nextCursor).toBe('cursor')
    await p.loadMore()
    expect(list).toHaveBeenLastCalledWith('p1.target', 'cursor')
    expect(p.data.people).toHaveLength(1)
    expect(p.data.nextCursor).toBe('')
  })
  it('clears stale identities when access is revoked and can retry after access returns', async () => {
    list.mockRejectedValueOnce(new MipOpportunityError('FORBIDDEN', '已无权限', false)).mockResolvedValueOnce({ items: [], totalCount: 0 })
    const p = page()
    await p.load()
    expect(p.data.state).toBe('blocked')
    expect(p.data.people).toEqual([])
    await p.load()
    expect(p.data.state).toBe('empty')
  })
})
