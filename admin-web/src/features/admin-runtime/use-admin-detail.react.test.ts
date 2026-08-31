import { describe, expect, it } from 'vitest'
import type { AdminDetailPager } from '../../modules/admin-details'
import { createDetailPageHistory, transitionDetailPage } from './use-admin-detail'

function pager(key: AdminDetailPager['key'], currentCursor: string | null, nextCursor: string | null): AdminDetailPager {
  return { key, query: `${key}-query`, currentCursor, nextCursor, placeholder: '搜索' }
}

describe('admin detail pagination state', () => {
  it('maps every pager to its own options and keeps cursor histories independent', () => {
    let history = createDetailPageHistory()
    let options = {}
    for (const [key, expected] of [
      ['eventRoster', 'event-cursor'],
      ['taskMembers', 'member-cursor'],
      ['taskCompletions', 'completion-cursor'],
      ['gameMembers', 'game-cursor'],
    ] as const) {
      const transition = transitionDetailPage(history, options, pager(key, null, expected), 'next')
      expect(transition).not.toBeNull()
      history = transition!.history
      options = transition!.options
    }

    expect(options).toMatchObject({
      eventRoster: { cursor: 'event-cursor' },
      task: {
        members: { query: 'taskMembers-query', cursor: 'member-cursor' },
        completions: { query: 'taskCompletions-query', cursor: 'completion-cursor' },
      },
      gameMembers: { query: 'gameMembers-query', cursor: 'game-cursor' },
    })
    expect(history).toEqual({
      eventRoster: [null], taskMembers: [null], taskCompletions: [null], gameMembers: [null],
    })

    const previousMemberPage = transitionDetailPage(
      history,
      options,
      pager('taskMembers', 'member-cursor', 'member-next'),
      'previous',
    )!
    expect(previousMemberPage.options.task?.members?.cursor).toBeNull()
    expect(previousMemberPage.history.taskMembers).toEqual([])
    expect(previousMemberPage.history.eventRoster).toEqual([null])
    expect(previousMemberPage.history.taskCompletions).toEqual([null])
    expect(previousMemberPage.history.gameMembers).toEqual([null])
  })
})
