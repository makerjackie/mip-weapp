import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadUserBadgeSummary, loadUserProfileGrowthSummaries, loadUserProfileRecords, type UserRecordQuery } from './user-profile-records.ts'
import type { AdminDetailRequest } from './admin-details.ts'

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminDetailRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

describe('user profile records', () => {
  it('merges card history and operation logs in the records tab with independent cursors', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadUserProfileRecords('user-1', 'records', { cursor: 'c1', logCursor: 'l1' }, requestWith({
      'mip.admin.cards.history': { items: [{ version: 3, createdAt: '2030-02-01T00:00:00.000Z', snapshot: { realName: '林晓', nickname: '晓', headline: '品牌顾问' } }], nextCursor: 'c2' },
      'mip.admin.users.operationLogs.list': { items: [{ id: 'log-1', action: 'admin.users.update', actorNickname: '运营成员', effectiveRole: 'PLATFORM_OPERATIONS', actorType: 'USER', createdAt: '2030-02-02T00:00:00.000Z' }], nextCursor: 'l2' },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.cards.history', input: { cardId: 'user-1', limit: 20, cursor: 'c1' } },
      { action: 'mip.admin.users.operationLogs.list', input: { userId: 'user-1', limit: 20, cursor: 'l1' } },
    ])
    // 资料历史在前，操作日志收尾。
    assert.equal(page.sections.length, 2)
    assert.ok(page.sections[0]?.title.startsWith('资料版本 3 · '))
    assert.deepEqual(page.sections[0]?.fields?.map(field => field.label), ['姓名', '昵称', '职位简介', '个人介绍', '公司与职位', '组织与职务', 'MIP 身份'])
    assert.equal(page.sections.at(-1)?.title, '用户操作日志')
    assert.equal(page.sections.at(-1)?.rows?.[0]?.actor, '运营成员')
    assert.equal(page.nextCursor, 'c2')
    assert.equal(page.logNextCursor, 'l2')
  })

  it('requests a single related section with cursor for the dedicated content tabs', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadUserProfileRecords('user-1', 'superCases', { cursor: 'cur-1' }, requestWith({
      'mip.admin.users.get': { id: 'user-1', relatedRecords: { section: 'superCases', superCases: [{ id: 'case-1', title: '品牌升级案例', status: 'PUBLISHED', startedOn: '2030-01-05T00:00:00.000Z' }], nextCursor: 'next-1' } },
    }, calls))

    assert.deepEqual(calls, [{ action: 'mip.admin.users.get', input: { userId: 'user-1', includePhone: false, relatedSection: 'superCases', limit: 20, cursor: 'cur-1' } }])
    assert.equal(page.sections[0]?.title, '超级案例')
    assert.equal(page.sections[0]?.rows?.[0]?.title, '品牌升级案例')
    assert.equal(page.nextCursor, 'next-1')
  })

  it('rejects related records whose identity does not match the requested user', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    await assert.rejects(loadUserProfileRecords('user-1', 'cooperationCards', {} as UserRecordQuery, requestWith({
      'mip.admin.users.get': { id: 'user-2', relatedRecords: { section: 'cooperationCards', cooperationCards: [] } },
    }, calls)))
  })

  it('loads growth summaries for invited guests and hearts without pagination', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const { sections } = await loadUserProfileGrowthSummaries('user-1', requestWith({
      'mip.admin.users.invitedGuests.list': { items: [{ id: 'g1', userId: 'user-9', nickname: '周宁', source: 'MEMBERSHIP', kind: 'PLAYER', createdAt: '2030-02-03T00:00:00.000Z' }], nextCursor: 'more' },
      'mip.admin.users.likeRelations.list': { items: [{ id: 'h1', userId: 'user-8', nickname: '陈默', source: 'EVENT', status: 'ACTIVE', direction: 'INCOMING', eventTitle: 'MIP 早会', createdAt: '2030-02-04T00:00:00.000Z' }] },
    }, calls))

    assert.deepEqual(calls, [
      { action: 'mip.admin.users.invitedGuests.list', input: { userId: 'user-1', limit: 5 } },
      { action: 'mip.admin.users.likeRelations.list', input: { userId: 'user-1', limit: 5, direction: 'ALL', status: '' } },
    ])
    assert.deepEqual(sections.map(section => section.title), ['邀请嘉宾', '心动明细'])
    assert.equal(sections[0]?.detailTarget, 'users')
    assert.equal(sections[0]?.rows?.[0]?.detailId, 'user-9')
    assert.equal(sections[0]?.rows?.[0]?.state, '玩家')
    assert.equal(sections[1]?.rows?.[0]?.state, '启用')
    assert.equal(sections[1]?.rows?.[0]?.eventTitle, 'MIP 早会')
  })

  it('loads the badge summary from active awards', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const items = await loadUserBadgeSummary('user-1', requestWith({
      'mip.admin.badges.awards': { items: [{ id: 'a1', badgeId: 'b1', badgeName: '助人徽章', equipped: true, status: 'ACTIVE' }] },
    }, calls))

    assert.deepEqual(calls, [{ action: 'mip.admin.badges.awards', input: { userId: 'user-1', status: 'ACTIVE', limit: 100 } }])
    assert.deepEqual(items, [{ id: 'a1', badgeName: '助人徽章', equipped: true }])
  })
})
