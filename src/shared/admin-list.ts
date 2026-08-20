export type AdminListState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden'

export interface AdminListPage<Item, Cursor> {
  items: Item[]
  nextCursor: Cursor | null
  totalCount?: number
}

export interface AdminListRequest<Query, Cursor> {
  cursor: Cursor | null
  force: boolean
  limit: number
  query: Query
}

export interface AdminListErrorView {
  message: string
  state?: Extract<AdminListState, 'error' | 'forbidden'>
}

export interface AdminListSnapshot<Item, Cursor> {
  state: AdminListState
  items: Item[]
  nextCursor: Cursor | null
  hasMore: boolean
  loadingMore: boolean
  message: string
  totalCount: number
}

export interface AdminListController<Item, Query, Cursor> {
  snapshot: () => AdminListSnapshot<Item, Cursor>
  refresh: (
    query: Query,
    options?: { force?: boolean },
  ) => Promise<AdminListSnapshot<Item, Cursor>>
  loadMore: () => Promise<AdminListSnapshot<Item, Cursor>>
}

export interface AdminListOptions<Item, Query, Cursor> {
  getId: (item: Item) => string
  getQueryKey: (query: Query) => string
  loadPage: (request: AdminListRequest<Query, Cursor>) => Promise<AdminListPage<Item, Cursor>>
  mapError?: (error: unknown, context: { hasContent: boolean }) => AdminListErrorView
  pageSize?: number
}

function defaultError(error: unknown, context: { hasContent: boolean }): AdminListErrorView {
  const message = error instanceof Error ? error.message : '列表暂时无法加载'
  return {
    message: context.hasContent ? `${message}，已保留上次结果。` : message,
    state: 'error',
  }
}

function uniqueItems<Item>(items: Item[], getId: (item: Item) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = getId(item)
    if (!id || seen.has(id)) {
      return false
    }
    seen.add(id)
    return true
  })
}

/**
 * Owns the non-visual lifecycle of an admin list: query replacement, stale
 * request suppression, append pagination, duplicate removal, background error
 * preservation, and load-more deduplication. Pages only translate snapshots
 * into their case-owned presentation.
 */
export function createAdminListController<Item, Query, Cursor = string>(
  options: AdminListOptions<Item, Query, Cursor>,
): AdminListController<Item, Query, Cursor> {
  const pageSize = options.pageSize ?? 20
  const mapError = options.mapError ?? defaultError
  let current: AdminListSnapshot<Item, Cursor> = {
    state: 'loading',
    items: [],
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    message: '',
    totalCount: 0,
  }
  let activeQuery: Query | undefined
  let activeQueryKey = ''
  let requestSequence = 0
  let appendPending: Promise<AdminListSnapshot<Item, Cursor>> | undefined

  function snapshot(): AdminListSnapshot<Item, Cursor> {
    return {
      ...current,
      items: [...current.items],
    }
  }

  async function refresh(
    query: Query,
    refreshOptions: { force?: boolean } = {},
  ): Promise<AdminListSnapshot<Item, Cursor>> {
    const queryKey = options.getQueryKey(query)
    const queryChanged = activeQuery !== undefined && queryKey !== activeQueryKey
    const sequence = ++requestSequence
    activeQuery = query
    activeQueryKey = queryKey
    appendPending = undefined
    current = queryChanged
      ? {
          state: 'loading',
          items: [],
          nextCursor: null,
          hasMore: false,
          loadingMore: false,
          message: '',
          totalCount: 0,
        }
      : {
          ...current,
          state: current.items.length ? 'ready' : 'loading',
          loadingMore: false,
          message: '',
        }
    try {
      const page = await options.loadPage({
        query,
        cursor: null,
        force: Boolean(refreshOptions.force),
        limit: pageSize,
      })
      if (sequence !== requestSequence) {
        return snapshot()
      }
      const items = uniqueItems(page.items, options.getId)
      current = {
        state: items.length ? 'ready' : 'empty',
        items,
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
        loadingMore: false,
        message: '',
        totalCount: page.totalCount ?? items.length,
      }
    }
    catch (error) {
      if (sequence !== requestSequence) {
        return snapshot()
      }
      const hasContent = current.items.length > 0
      const view = mapError(error, { hasContent })
      current = {
        ...current,
        state: hasContent ? 'ready' : (view.state ?? 'error'),
        loadingMore: false,
        message: view.message,
      }
    }
    return snapshot()
  }

  async function loadMore(): Promise<AdminListSnapshot<Item, Cursor>> {
    if (appendPending) {
      return appendPending
    }
    if (activeQuery === undefined || current.nextCursor === null || current.loadingMore) {
      return snapshot()
    }
    const sequence = requestSequence
    const query = activeQuery
    const cursor = current.nextCursor
    current = { ...current, loadingMore: true, message: '' }
    appendPending = options.loadPage({
      query,
      cursor,
      force: false,
      limit: pageSize,
    }).then((page) => {
      if (sequence !== requestSequence) {
        return snapshot()
      }
      const items = uniqueItems([...current.items, ...page.items], options.getId)
      current = {
        state: items.length ? 'ready' : 'empty',
        items,
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
        loadingMore: false,
        message: '',
        totalCount: page.totalCount ?? Math.max(current.totalCount, items.length),
      }
      return snapshot()
    }).catch((error) => {
      if (sequence === requestSequence) {
        current = {
          ...current,
          state: current.items.length ? 'ready' : 'error',
          loadingMore: false,
          message: mapError(error, { hasContent: current.items.length > 0 }).message,
        }
      }
      return snapshot()
    }).finally(() => {
      if (sequence === requestSequence) {
        appendPending = undefined
      }
    })
    return appendPending
  }

  return { snapshot, refresh, loadMore }
}
