import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import {
  loadAdminDetail,
  type AdminDetailOptions,
  type AdminDetailPager,
  type AdminDetailPagerKey,
  type AdminDetailRoute,
} from '../../modules/admin-details'

interface DetailSelection {
  route: AdminDetailRoute
  id: string
  options?: AdminDetailOptions
}

export type DetailPageHistory = Record<AdminDetailPagerKey, Array<string | null>>

export function useAdminDetail() {
  const { demoMode, hasCapability, hasCapabilityAtScope, request, session, sessionBoundary } = useAdminSession()
  const [selection, setSelection] = useState<DetailSelection | null>(null)
  const pageHistory = useRef<DetailPageHistory>(createDetailPageHistory())
  const options = useMemo<AdminDetailOptions>(() => ({
    ...selection?.options,
    includeUserMembership: selection?.route === 'users' && hasCapabilityAtScope('memberships.read', 'PLATFORM'),
    includeEventRoster: selection?.route === 'events' && hasCapability('events.roster.read'),
    includeEventAlbum: selection?.route === 'events' && hasCapability('events.album.manage'),
    includeMessageDeliveryReviews: selection?.route === 'messages' && hasCapabilityAtScope('messages.delivery.review', 'PLATFORM'),
    includeOpportunityComments: selection?.route === 'opportunities' && hasCapability('messages.manage'),
  }), [hasCapability, hasCapabilityAtScope, selection])

  const detail = useQuery({
    queryKey: ['admin-detail', session?.actor?.id || 'anonymous', sessionBoundary, selection?.route, selection?.id, options],
    enabled: Boolean(selection && !demoMode && session?.enabled),
    queryFn: () => loadAdminDetail(selection!.route, selection!.id, request, options),
  })

  const openDetail = useCallback((route: AdminDetailRoute, id: string, nextOptions?: AdminDetailOptions) => {
    if (!id) return
    pageHistory.current = createDetailPageHistory()
    setSelection({ route, id, options: nextOptions })
  }, [])

  const closeDetail = useCallback(() => {
    pageHistory.current = createDetailPageHistory()
    setSelection(null)
  }, [])

  const changeDetailPage = useCallback((pager: AdminDetailPager, direction: 'previous' | 'next') => {
    const transition = selection
      ? transitionDetailPage(pageHistory.current, selection.options, pager, direction)
      : null
    if (!transition) return
    pageHistory.current = transition.history
    setSelection(current => current ? { ...current, options: transition.options } : current)
  }, [selection])

  return {
    selection,
    view: detail.data || null,
    loading: detail.isLoading,
    error: demoMode && selection
      ? '演示模式不返回服务端详情。请连接管理 API 后查看。'
      : detail.error instanceof Error ? detail.error.message : '',
    openDetail,
    closeDetail,
    changeDetailPage,
    refreshDetail: detail.refetch,
  }
}

export function createDetailPageHistory(): DetailPageHistory {
  return { eventRoster: [], taskMembers: [], taskCompletions: [], gameMembers: [] }
}

export function transitionDetailPage(
  history: DetailPageHistory,
  options: AdminDetailOptions | undefined,
  pager: AdminDetailPager,
  direction: 'previous' | 'next',
): { history: DetailPageHistory; options: AdminDetailOptions } | null {
  const keyHistory = [...history[pager.key]]
  let cursor: string | null
  if (direction === 'next') {
    if (!pager.nextCursor) return null
    keyHistory.push(pager.currentCursor)
    cursor = pager.nextCursor
  }
  else {
    if (!keyHistory.length && !pager.currentCursor) return null
    cursor = keyHistory.pop() ?? null
  }
  return {
    history: { ...history, [pager.key]: keyHistory },
    options: detailOptionsWithCursor(options, pager, cursor),
  }
}

function detailOptionsWithCursor(
  options: AdminDetailOptions | undefined,
  pager: AdminDetailPager,
  cursor: string | null,
): AdminDetailOptions {
  if (pager.key === 'eventRoster') {
    return { ...options, eventRoster: { ...options?.eventRoster, cursor } }
  }
  if (pager.key === 'taskMembers') {
    return {
      ...options,
      task: { ...options?.task, members: { ...options?.task?.members, query: pager.query, cursor } },
    }
  }
  if (pager.key === 'taskCompletions') {
    return {
      ...options,
      task: { ...options?.task, completions: { ...options?.task?.completions, query: pager.query, cursor } },
    }
  }
  return { ...options, gameMembers: { ...options?.gameMembers, query: pager.query, cursor } }
}
