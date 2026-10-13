import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseReceivedVisitors } from '../src/modules/mip-opportunities/received-visitors'

const require = createRequire(import.meta.url)
const { listReceivedInteractions } = require('../cloudfunctions/mip-opportunities-api/domain/received-interactions.js')

describe('visitor service to client contract', () => {
  it('adapts an actual non-empty server response to the actor expected by the page', async () => {
    // MIW-74：服务端按人聚合——行形状为聚合口径（visit_count/unread_visit_count），一次查询一人一行。
    const result = await listReceivedInteractions({
      query: async () => [{ visit_id: '33333333-3333-4333-8333-333333333333', visitor_id: '22222222-2222-4222-8222-222222222222', visitor_nickname: '访客甲', visit_count: 3, unread_visit_count: 1, last_visited_at: '2026-09-12T03:00:00.000Z', is_player: 1 }],
      one: async () => ({ count: 1 }),
    }, { appId: 'test-app', userId: '11111111-1111-4111-8111-111111111111', profileRefSecret: 'test-secret-with-at-least-32-characters' }, { category: 'VISITOR' })
    expect(result.items[0].actor).toBeUndefined()
    const page = parseReceivedVisitors(result)
    expect(page.items[0]).toMatchObject({ kind: 'VISITOR', actor: { nickname: '访客甲', userKind: 'PLAYER' }, visitCount: 3, unread: true })
  })

  it('carries the server inviter annotation through to the visitor actor (MIW-85)', () => {
    const base = { visitCount: 1, unread: false, lastVisitedAt: '2026-10-08T11:01:57.348Z' }
    const page = parseReceivedVisitors({
      unreadCount: 0,
      items: [{ profileRef: 'p1.inviter-carried', nickname: '访客乙', userKind: 'GUEST', ...base, inviter: { sourceType: 'USER', displayName: '铭龙' } }],
    })
    expect(page.items[0].actor.inviter).toEqual({ sourceType: 'USER', displayName: '铭龙' })
    const bare = parseReceivedVisitors({
      unreadCount: 0,
      items: [{ profileRef: 'p1.inviter-omitted', nickname: '访客丙', userKind: 'GUEST', ...base }],
    })
    expect(bare.items[0].actor.inviter).toBeUndefined()
    // 畸形 inviter 复用 parseProfileInterestInviter 的受控错误（同口径文案），不泄漏 TypeError。
    expect(() => parseReceivedVisitors({
      unreadCount: 0,
      items: [{ profileRef: 'p1.inviter-malformed', nickname: '访客丁', userKind: 'GUEST', ...base, inviter: { sourceType: 'USER' } }],
    })).toThrow('感兴趣名单返回的数据格式不正确')
  })

  it('rejects malformed data with a controlled error instead of leaking a TypeError', () => {
    for (const value of [undefined, {}, { items: [null], unreadCount: 0 }, { items: [{}], unreadCount: 0 }]) {
      expect(() => parseReceivedVisitors(value)).toThrow('访客服务返回的数据格式不正确')
    }
  })
})
