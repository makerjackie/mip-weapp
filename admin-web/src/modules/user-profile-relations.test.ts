import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { AdminRequest } from './admin-read-contracts'
import { loadUserRelations } from './user-profile-relations.ts'
it('forwards all heart filters and shows links only for server-authorized targets', async () => {
  let input: unknown
  const request: AdminRequest = async <T>(_action: string, body?: unknown) => { input = body; return { items: [{ id: 'a', nickname: '测试用户', userId: 'visible', direction: 'INCOMING', status: 'CANCELLED', eventId: 'hidden-event', eventDetailAllowed: false, createdAt: '2030-01-01' }], nextCursor: 'next' } as T }
  const page = await loadUserRelations('user-a', 'hearts', { q: '测试', direction: 'INCOMING', status: 'CANCELLED', eventId: 'event-a', sinceTime: '2030-01-01', untilTime: '2030-02-01', cursor: 'cursor-a' }, request)
  assert.deepEqual(input, { userId: 'user-a', limit: 20, query: '测试', direction: 'INCOMING', status: 'CANCELLED', eventId: 'event-a', sinceTime: '2030-01-01', untilTime: '2030-02-01', cursor: 'cursor-a' })
  assert.equal(page.section.rows?.[0].state, '已撤销')
  assert.deepEqual(page.section.rows?.[0].detailLinks, [{ route: 'users', id: 'visible', label: '用户档案' }])
  assert.equal(page.nextCursor, 'next')
})
