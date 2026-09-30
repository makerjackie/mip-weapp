import { describe, expect, it } from 'vitest'
import type { AdminDetailPager } from '../../modules/admin-details'
import { createDetailPageHistory, transitionDetailPage } from './use-admin-detail'

function pager(key: AdminDetailPager['key'], currentCursor: string | null, nextCursor: string | null): AdminDetailPager {
  return { key, query: `${key}-query`, currentCursor, nextCursor, placeholder: '搜索' }
}

describe('admin detail pagination state', () => {
  it('resets only the roster cursor when its search/status changes, retaining other sections', () => {
    const history = { ...createDetailPageHistory(), eventRoster: [null, 'old'], eventFeedback: [null] }
    const next = transitionDetailPage(history, { eventRoster: { cursor: 'old-next' }, eventFeedback: { cursor: 'feedback-2' } },
      { ...pager('eventRoster', 'old-next', 'old-3'), query: '林', status: 'ATTENDED' }, 'search')!
    expect(next.options.eventRoster).toEqual({ cursor: null, query: '林', status: 'ATTENDED' })
    expect(next.options.eventFeedback).toEqual({ cursor: 'feedback-2' })
    expect(next.history.eventRoster).toEqual([])
    expect(next.history.eventFeedback).toEqual([null])
  })
  it('maps every pager to its own options and keeps cursor histories independent', () => {
    let history = createDetailPageHistory()
    let options = {}
    for (const [key, expected] of [
      ['eventRoster', 'event-cursor'],
      ['eventFeedback', 'feedback-cursor'],
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
      eventFeedback: { cursor: 'feedback-cursor' },
      task: {
        members: { query: 'taskMembers-query', cursor: 'member-cursor' },
        completions: { query: 'taskCompletions-query', cursor: 'completion-cursor' },
      },
      gameMembers: { query: 'gameMembers-query', cursor: 'game-cursor' },
    })
    expect(history).toEqual({
      eventRoster: [null], eventFeedback: [null], taskMembers: [null], taskCompletions: [null], gameMembers: [null], messageDeliveries: [], messageReviews: [],
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
    expect(previousMemberPage.history.eventFeedback).toEqual([null])
    expect(previousMemberPage.history.taskCompletions).toEqual([null])
    expect(previousMemberPage.history.gameMembers).toEqual([null])
  })
})
