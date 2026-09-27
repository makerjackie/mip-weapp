import { Select, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminOperationAction } from '../../domain/contracts'

interface UserOption {
  value: string
  label: string
}

function catalogOptions(payload: unknown): UserOption[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const items = Array.isArray(record.items) ? record.items : Array.isArray(payload) ? payload : []
  return items.map(item => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const value = String(entry.id || entry.value || '')
    return { value, label: String(entry.name || entry.label || entry.nickname || value) }
  }).filter(option => option.value)
}

/**
 * Session-backed catalog select. Loads options once from a reviewed query action
 * (for example branch or badge catalogs) instead of requiring a pasted UUID.
 */
export function RemoteCatalogSelect({
  action,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  action: string
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const { request } = useAdminSession()
  const [options, setOptions] = useState<UserOption[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void request(action as AdminOperationAction).then(payload => { if (active) setOptions(catalogOptions(payload)) })
        .catch(() => { if (active) setFailed(true) })
    }, 0)
    return () => { active = false; clearTimeout(timer) }
  }, [action, request])

  const merged = useMemo(() => {
    if (value && !options.some(option => option.value === value)) return [{ value, label: value }, ...options]
    return options
  }, [options, value])

  return (
    <Select
      showSearch
      optionFilterProp="label"
      value={value || undefined}
      placeholder={placeholder || '请选择'}
      disabled={disabled}
      allowClear
      notFoundContent={failed ? '目录加载失败' : undefined}
      options={merged}
      onChange={next => onChange?.(next || '')}
    />
  )
}


const SEARCH_LIMIT = 50

/**
 * Searchable user picker backed by the session request channel.
 * Loads an initial page and re-queries the server on search so admins beyond
 * the first page of users remain selectable.
 */
export function SessionUserSelect({
  value,
  onChange,
  disabled,
  placeholder = '搜索姓名或简介',
}: {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const { request } = useAdminSession()
  const [options, setOptions] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (query: string) => {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const payload = await request<Record<string, unknown>>('mip.admin.users.list', {
        filters: query ? { query } : {},
        limit: SEARCH_LIMIT,
      })
      if (id !== requestId.current) return
      const items = Array.isArray(payload?.items) ? payload.items : []
      setOptions(items.map(item => {
        const user = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const userId = String(user.id || user.userId || '')
        return { value: userId, label: String(user.nickname || user.name || '未设置昵称') }
      }).filter(option => option.value))
    }
    catch {
      if (id === requestId.current) setFailed(true)
    }
    finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [request])

  useEffect(() => {
    const initial = setTimeout(() => void load(''), 0)
    return () => {
      clearTimeout(initial)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  const merged = useMemo(() => {
    if (value && !options.some(option => option.value === value)) return [{ value, label: value }, ...options]
    return options
  }, [options, value])

  return (
    <Select
      showSearch
      value={value || undefined}
      placeholder={placeholder}
      disabled={disabled}
      filterOption={false}
      allowClear
      notFoundContent={loading ? <Spin size="small" /> : failed ? '用户搜索暂不可用' : '没有匹配的用户'}
      options={merged}
      onChange={next => onChange?.(next || '')}
      onSearch={query => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(query.trim()), 300)
      }}
    />
  )
}
