import fs from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipOpportunityError } from '../src/modules/mip-opportunities/error'
import { parseOpportunityCooperators } from '../src/modules/mip-opportunities/validation'

const { list, navigate } = vi.hoisted(() => ({ list: vi.fn(), navigate: vi.fn() }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { listCooperators: list }, MipOpportunityError }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigate }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/mip-opportunity-cooperators/index')
})
beforeEach(() => {
  list.mockReset()
  navigate.mockReset()
})
function page() {
  const result = Object.create(definition)
  result.data = structuredClone(definition.data)
  result.setData = (patch: Record<string, unknown>) => Object.assign(result.data, patch)
  result.onLoad({ id: '30000000-0000-4000-8000-000000000009' })
  return result
}

const require = createRequire(import.meta.url)
const { listOpportunityCooperators } = require('../cloudfunctions/mip-opportunities-api/domain/opportunity-cooperations')

const caller = { appId: 'wx-cooperators-contract', userId: '10000000-0000-4000-8000-000000000001', profileRefSecret: 'cooperators-contract-secret-over-thirty-two-characters' }
const opportunityId = '30000000-0000-4000-8000-000000000009'
const cooperatorId = '20000000-0000-4000-8000-000000000001'

describe('opportunity cooperators page contract (G1 figma 1769_37984)', () => {
  it('shows a non-empty real server DTO as grid talent cards with inviter annotations', async () => {
    const rosterRow = {
      id: '40000000-0000-4000-8000-000000000001',
      opportunity_id: opportunityId,
      user_id: cooperatorId,
      nickname: 'Ame',
      headline: '设计',
      visibility_json: {},
      avatar_file_id: 'cloud://avatar',
      activated_at: '2026-10-01T02:30:00.000Z',
    }
    const db = {
      async one(sql: string) {
        if (sql.includes('FROM mip_opportunities o')) {
          return { id: opportunityId, owner_user_id: '10000000-0000-4000-8000-000000000002', status: 'PUBLISHED' }
        }
        if (sql.includes('FROM mip_membership_entitlements')) {
          return { id: 'entitlement' }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
      async query(sql: string) {
        if (sql.includes('FROM mip_opportunity_cooperations')) {
          return [rosterRow]
        }
        if (sql.includes('FROM mip_profiles profile')) {
          return [{ user_id: cooperatorId, visibility_json: {}, city_name: '深圳', industry_label: '软件', identity_status: '创业者', introduction: '帮助团队建立设计系统', experience_balance: 100 }]
        }
        if (sql.includes('FROM mip_growth_levels')) {
          return [{ id: 'lv1', name: '初识', minimum_experience: 0, status: 'ACTIVE' }, { id: 'lv2', name: '共建', minimum_experience: 100, status: 'ACTIVE' }]
        }
        if (sql.includes('FROM mip_user_badge_equipment')) {
          return [{ user_id: cooperatorId, id: 'badge-1', name: '社区共建者' }]
        }
        if (sql.includes('FROM mip_event_invitation_attributions')) {
          return [{ guest_user_id: cooperatorId, invitation_source_type: 'USER', inviter_nickname: 'Bear', inviter_visibility_json: {}, inviter_avatar_file_id: 'cloud://bear' }]
        }
        return []
      },
    }
    const response = await listOpportunityCooperators(db, caller, { id: opportunityId, limit: 20 })
    list.mockResolvedValue(parseOpportunityCooperators(response))
    const p = page()
    await p.load()
    expect(p.data.state).toBe('ready')
    // 竖版人才卡口径对齐 mip-profile-interests：Lv / 三标签（地区MIP | 行业 | 身份状态）/
    // 两行简介（introduction 优先）/ 佩戴勋章 / 邀请人（USER=昵称+头像）。
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
    const template = fs.readFileSync(new URL('../src/packages/member/mip-opportunity-cooperators/index.wxml', import.meta.url), 'utf8')
    for (const attr of ['layout="grid"', 'display-name="{{item.displayName}}"', 'level-text="{{item.levelText}}"', 'tags="{{item.profileTags}}"', 'supporting-text="{{item.supportingText}}"', 'medals="{{item.medals}}"', 'inviter-name="{{item.inviterName}}"', 'inviter-avatar-url="{{item.inviterAvatarUrl}}"', 'inviter-kind="{{item.inviterKind}}"']) {
      expect(template).toContain(attr)
    }
    p.openProfile({ currentTarget: { dataset: { profileRef: p.data.people[0].profileRef } } })
    expect(navigate).toHaveBeenCalledWith({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(p.data.people[0].profileRef)}` })
  })

  it('keeps newest-first server order, paginates by cursor and never fabricates missing fields', () => {
    const person = parseOpportunityCooperators({
      items: [{ profileRef: 'p1.a', nickname: 'Ame' }],
      nextCursor: 'cursor',
    })
    // 服务端 activated_at DESC 已排序，页面按返回顺序原样展示；缺省详情不造值。
    expect(person.items[0]).toEqual({ profileRef: 'p1.a', nickname: 'Ame', headline: undefined, avatarUrl: undefined })
    expect(person.nextCursor).toBe('cursor')
    expect(() => parseOpportunityCooperators({ items: [{ profileRef: 'p1.a', nickname: 'Ame', userId: 'private' }] })).toThrow()
    expect(() => parseOpportunityCooperators({ items: [{ profileRef: 'p1.a', nickname: 'Ame', level: { number: 0, name: '初识' } }] })).toThrow()
    expect(() => parseOpportunityCooperators({ items: [{ profileRef: 'p1.a', nickname: 'Ame', inviter: { sourceType: 'BOT', displayName: 'x' } }] })).toThrow()
    expect(parseOpportunityCooperators({
      items: [{ profileRef: 'p1.a', nickname: 'Ame', level: { number: 2, name: '共建' }, badges: [{ id: 'b', name: '共建者' }], inviter: { sourceType: 'PLATFORM', displayName: 'MIP 平台' } }],
    }).items[0]).toMatchObject({ level: { number: 2, name: '共建' }, badges: [{ id: 'b' }], inviter: { sourceType: 'PLATFORM', displayName: 'MIP 平台' } })
  })

  it('shows the dedicated empty state and keeps the loaded list on a pagination failure', async () => {
    list.mockResolvedValueOnce(parseOpportunityCooperators({ items: [{ profileRef: 'p1.first', nickname: 'Ame' }], totalCount: 2, nextCursor: 'cursor' }))
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce(parseOpportunityCooperators({ items: [], nextCursor: undefined }))
    const p = page()
    await p.load()
    await p.loadMore()
    expect(p.data.state).toBe('ready')
    expect(p.data.people).toHaveLength(1)
    expect(p.data.nextCursor).toBe('cursor')
    await p.loadMore()
    expect(list).toHaveBeenLastCalledWith(opportunityId, 'cursor')
    expect(p.data.people).toHaveLength(1)
    expect(p.data.nextCursor).toBe('')
    // 空态文案固定「暂无合作意向」
    const template = fs.readFileSync(new URL('../src/packages/member/mip-opportunity-cooperators/index.wxml', import.meta.url), 'utf8')
    expect(template).toContain('暂无合作意向')
  })

  it('lands on a blocked state when the roster is revoked and retries back to empty', async () => {
    list.mockRejectedValueOnce(new MipOpportunityError('FORBIDDEN', '已无权限', false)).mockResolvedValueOnce({ items: [], totalCount: 0 })
    const p = page()
    await p.load()
    expect(p.data.state).toBe('blocked')
    expect(p.data.people).toEqual([])
    await p.load()
    expect(p.data.state).toBe('empty')
  })
})
