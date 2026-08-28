import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import {
  loadAdminDetail,
  type AdminDetailOptions,
  type AdminDetailRoute,
} from '../../modules/admin-details'

interface DetailSelection {
  route: AdminDetailRoute
  id: string
  options?: AdminDetailOptions
}

export function useAdminDetail() {
  const { demoMode, hasCapability, request } = useAdminSession()
  const [selection, setSelection] = useState<DetailSelection | null>(null)
  const options = useMemo<AdminDetailOptions>(() => ({
    ...selection?.options,
    includeEventAlbum: selection?.route === 'events' && hasCapability('events.album.manage'),
  }), [hasCapability, selection])

  const detail = useQuery({
    queryKey: ['admin-detail', selection?.route, selection?.id, options],
    enabled: Boolean(selection && !demoMode),
    queryFn: () => loadAdminDetail(selection!.route, selection!.id, request, options),
  })

  const openDetail = useCallback((route: AdminDetailRoute, id: string, nextOptions?: AdminDetailOptions) => {
    if (!id) return
    setSelection({ route, id, options: nextOptions })
  }, [])

  const closeDetail = useCallback(() => setSelection(null), [])

  return {
    selection,
    view: detail.data || null,
    loading: detail.isLoading,
    error: demoMode && selection
      ? '演示模式不返回服务端详情。请连接管理 API 后查看。'
      : detail.error instanceof Error ? detail.error.message : '',
    openDetail,
    closeDetail,
    refreshDetail: detail.refetch,
  }
}
