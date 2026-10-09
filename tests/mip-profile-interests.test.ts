import fs from 'node:fs'
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
      query: async (sql: string) => sql.includes('FROM mip_profiles profile')
        ? [{ user_id: actor, visibility_json: {}, experience_balance: 100, city_name: '深圳', industry_label: '软件', identity_status: '创业者', introduction: '帮助团队建立设计系统' }]
        : sql.includes('FROM mip_growth_levels')
          ? [{ id: 'lv1', name: '初识', minimum_experience: 0, status: 'ACTIVE' }, { id: 'lv2', name: '共建', minimum_experience: 100, status: 'ACTIVE' }]
          : sql.includes('FROM mip_user_badge_equipment')
            ? [{ user_id: actor, id: 'badge-1', name: '社区共建者' }]
            : sql.includes('FROM mip_event_invitation_attributions')
              ? [{ guest_user_id: actor, invitation_source_type: 'USER', inviter_nickname: 'Bear', inviter_visibility_json: {}, inviter_avatar_file_id: 'cloud://bear' }]
              : [{ actor_user_id: actor, actor_nickname: 'Ame', actor_headline: '设计', is_player: 1, updated_at: '2026-09-22T02:30:00.000Z', actor_visibility_json: {} }],
    }, caller, { profileRef: createProfileRef({ appId, userId: owner }, pepper) })
    list.mockResolvedValue(parseProfileInterests(response))
    const p = page()
    await p.load()
    expect(p.data.state).toBe('ready')
    // MIW-24：名单卡走统一嘉宾卡组件，页面 presenter 把服务端事实映射为视图字段；
    // 简介取 introduction 优先于 headline，勋章接服务端佩戴口径（无图不伪造勋章图）。
    // MIW-52：统一三标签（地区MIP | 代表行业 | 身份状态）替换旧 metaText 斜杠串。
    // G3：邀请人标注（figma 2189_43192 邀请人Bear + 头像）随服务端归档返回，无归档省略。
    expect(p.data.people[0]).toMatchObject({
      displayName: 'Ame',
      levelText: 'Lv.2',
      profileTags: ['深圳MIP', '软件', '创业者'],
      supportingText: '帮助团队建立设计系统',
      medals: [{ id: 'badge-1' }],
      inviterName: 'Bear',
      inviterAvatarUrl: 'cloud://bear',
      inviterKind: 'PLAYER',
    })
    const template = fs.readFileSync(new URL('../src/packages/member/mip-profile-interests/index.wxml', import.meta.url), 'utf8')
    for (const attr of ['layout="grid"', 'display-name="{{item.displayName}}"', 'level-text="{{item.levelText}}"', 'tags="{{item.profileTags}}"', 'supporting-text="{{item.supportingText}}"', 'medals="{{item.medals}}"', 'inviter-name="{{item.inviterName}}"', 'inviter-avatar-url="{{item.inviterAvatarUrl}}"', 'inviter-kind="{{item.inviterKind}}"']) {
      expect(template).toContain(attr)
    }
    expect(p.data.totalCount).toBe(1)
    p.openProfile({ currentTarget: { dataset: { profileRef: p.data.people[0].profileRef } } })
    expect(navigate).toHaveBeenCalledWith({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(p.data.people[0].profileRef)}` })
  })
  it('uses the authoritative growth threshold semantics and omits unavailable levels', () => {
    const { levelSnapshot } = require('../cloudfunctions/mip-growth-api/domain/rules')
    const { publicLevel } = require('../cloudfunctions/mip-opportunities-api/domain/public-person-details')
    const levels = [
      { id: 'a', name: '初识', minimum_experience: 0, status: 'ACTIVE' },
      { id: 'disabled', name: '不显示', minimum_experience: 50, status: 'DISABLED' },
      { id: 'b', name: '共建', minimum_experience: 100, status: 'ACTIVE' },
      { id: 'c', name: '同行', minimum_experience: 300, status: 'ACTIVE' },
    ]
    for (const experience of [0, 99, 100, 299, 300, 1000]) {
      const authoritative = levelSnapshot({ experience_balance: experience }, levels)
      expect(publicLevel(experience, levels).level).toEqual({
        number: authoritative.levels.findIndex((item: { id: string }) => item.id === authoritative.currentLevel.id) + 1,
        name: authoritative.currentLevel.name,
      })
    }
    expect(publicLevel(null, levels)).toEqual({})
    expect(publicLevel(100, [])).toEqual({})
    expect(publicLevel(100, levels.slice(1))).toEqual({})
  })
  it('omits private roster details using the same public profile visibility switches', async () => {
    const { loadPublicPersonDetails } = require('../cloudfunctions/mip-opportunities-api/domain/public-person-details')
    const result = await loadPublicPersonDetails({ query: async (sql: string) => sql.includes('FROM mip_profiles profile')
      ? [{ user_id: 'actor', visibility_json: { primaryBranch: false, industry: false, identityStatus: false, introduction: false }, city_name: 'private-city', industry_label: 'private-industry', identity_status: 'private-identity', introduction: 'private-intro' }]
      : [] }, 'test-app', ['actor'])
    expect(result.get('actor')).toEqual({ badges: [] })
  })
  it('rejects malformed list fields and strips private data', () => {
    const person = { profileRef: 'p1.person', nickname: 'Ame', userKind: 'PLAYER', interestedAt: '2026-09-22T02:30:00Z', phone: 'private', openid: 'private' }
    expect(parseProfileInterests({ items: [person], totalCount: 1 }).items[0]).not.toHaveProperty('phone')
    expect(() => parseProfileInterests({ items: [{ ...person, interestedAt: '' }], totalCount: 1 })).toThrow('格式不正确')
    expect(() => parseProfileInterests({ items: [person], totalCount: '1' })).toThrow('格式不正确')
    // G3：inviter 严格校验（responseAuthorInviter 口径）——未知键/畸形整页拒绝，合法结构保留。
    expect(parseProfileInterests({
      items: [{ ...person, inviter: { sourceType: 'PLATFORM', displayName: 'MIP 平台' } }],
      totalCount: 1,
    }).items[0]?.inviter).toEqual({ sourceType: 'PLATFORM', displayName: 'MIP 平台' })
    for (const inviter of [
      { sourceType: 'BOT', displayName: 'x' },
      { sourceType: 'USER', displayName: '' },
      { sourceType: 'USER', displayName: 'Bear', extra: 1 },
      { sourceType: 'USER' },
      'Bear',
    ]) {
      expect(() => parseProfileInterests({ items: [{ ...person, inviter }], totalCount: 1 })).toThrow('格式不正确')
    }
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
