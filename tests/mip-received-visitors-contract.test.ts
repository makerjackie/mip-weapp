import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseReceivedVisitors } from '../src/modules/mip-opportunities/received-visitors'

const require = createRequire(import.meta.url)
const { listReceivedInteractions } = require('../cloudfunctions/mip-opportunities-api/domain/received-interactions.js')

describe('visitor service to client contract', () => {
  it('adapts an actual non-empty server response to the actor expected by the page', async () => {
    const result = await listReceivedInteractions({
      query: async () => [{ visit_id: '33333333-3333-4333-8333-333333333333', visitor_id: '22222222-2222-4222-8222-222222222222', visitor_nickname: '访客甲', visit_count: 3, last_visited_at: '2026-09-12T03:00:00.000Z', has_unread: 1, is_player: 1 }],
      one: async () => ({ count: 1 }),
    }, { appId: 'test-app', userId: '11111111-1111-4111-8111-111111111111', profileRefSecret: 'test-secret-with-at-least-32-characters' }, { category: 'VISITOR' })
    expect(result.items[0].actor).toBeUndefined()
    const page = parseReceivedVisitors(result)
    expect(page.items[0]).toMatchObject({ kind: 'VISITOR', actor: { nickname: '访客甲', userKind: 'PLAYER' }, visitCount: 1, unread: true })
  })

  it('rejects malformed data with a controlled error instead of leaking a TypeError', () => {
    for (const value of [undefined, {}, { items: [null], unreadCount: 0 }, { items: [{}], unreadCount: 0 }]) {
      expect(() => parseReceivedVisitors(value)).toThrow('访客服务返回的数据格式不正确')
    }
  })
})
