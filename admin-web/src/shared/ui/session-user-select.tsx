import { Select, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminOperationAction } from '../../domain/contracts'
import type { AdminRequestInput } from '../../domain/contracts'

interface UserOption {
  value: string
  label: string
}

function catalogOptions(payload: unknown, optionsKey?: string, filter?: { key: string; value: string }, valueKey = 'id'): UserOption[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const selected = optionsKey ? record[optionsKey] : record.items
  const items = Array.isArray(selected) ? selected : Array.isArray(payload) ? payload : []
  return items.filter(item => !filter || item && typeof item === 'object' && String((item as Record<string, unknown>)[filter.key]) === filter.value).map(item => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const value = String(entry[valueKey] || entry.id || entry.value || '')
    return { value, label: String(entry.name || entry.label || entry.nickname || entry.title || '未命名选项') }
  }).filter(option => option.value)
}

/**
 * Session-backed catalog select. Loads options once from a reviewed query action
 * (for example branch or badge catalogs) instead of requiring a pasted UUID.
 */
export function RemoteCatalogSelect({
  id,
  action,
  value,
  onChange,
  disabled,
  placeholder,
  optionsKey,
  multiple,
  filter,
  input,
  valueKey,
}: {
  id?: string
  action: string
  value?: string | string[]
  onChange?: (value: string | string[]) => void
  disabled?: boolean
  placeholder?: string
  optionsKey?: string
  multiple?: boolean
  filter?: { key: string; value: string }
  input?: AdminRequestInput
  valueKey?: string
}) {
  const { request } = useAdminSession()
  const [options, setOptions] = useState<UserOption[]>([])
  const [failed, setFailed] = useState(false)
  const [policyDisabled, setPolicyDisabled] = useState(false)
  const filterKey = filter?.key, filterValue = filter?.value
  const inputKey = JSON.stringify(input || {})

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      setFailed(false)
      void (async () => {
        let payload = await request<Record<string, unknown>>(action as AdminOperationAction, JSON.parse(inputKey))
        if (!optionsKey && Array.isArray(payload?.items)) {
          const items = [...payload.items], seen = new Set<string>()
          while (payload.nextCursor) {
            const cursor = String(payload.nextCursor)
            if (seen.has(cursor) || seen.size >= 100) throw new Error('目录分页异常，请刷新重试')
            seen.add(cursor)
            payload = await request<Record<string, unknown>>(action as AdminOperationAction, { ...JSON.parse(inputKey), cursor })
            if (!active) return
            if (!Array.isArray(payload.items)) throw new Error('目录返回字段不完整')
            items.push(...payload.items)
          }
          payload = { ...payload, items }
        }
        return payload
      })().then(payload => {
        if (!active) return
        setOptions(catalogOptions(payload, optionsKey, filterKey ? { key: filterKey, value: filterValue || '' } : undefined, valueKey))
        setPolicyDisabled(Boolean(payload && typeof payload === 'object' && 'bindingWritesEnabled' in payload && payload.bindingWritesEnabled === false))
      })
        .catch(() => { if (active) setFailed(true) })
    }, 0)
    return () => { active = false; clearTimeout(timer) }
  }, [action, optionsKey, request, filterKey, filterValue, inputKey, valueKey])

  const merged = useMemo(() => {
    const values = Array.isArray(value) ? value : value ? [value] : []
    return [...values.filter(item => !options.some(option => option.value === item)).map(item => ({ value: item, label: '已选项（等待目录核对）' })), ...options]
  }, [options, value])

  return (
    <Select
      id={id}
      showSearch
      mode={multiple ? 'multiple' : undefined}
      optionFilterProp="label"
      value={value || undefined}
      placeholder={placeholder || '请选择'}
      disabled={disabled || policyDisabled}
      allowClear
      notFoundContent={failed ? '目录加载失败' : undefined}
      options={merged}
      onChange={next => onChange?.(next || (multiple ? [] : ''))}
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
  id,
  value,
  onChange,
  disabled,
  placeholder = '搜索姓名或简介',
  action = 'mip.admin.users.list',
  input,
}: {
  id?: string
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
  action?: string
  input?: AdminRequestInput
}) {
  const { request } = useAdminSession()
  const [options, setOptions] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)
  const inputKey = JSON.stringify(input || {})

  const load = useCallback(async (query: string) => {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const payload = await request<Record<string, unknown>>(action as AdminOperationAction, action === 'mip.admin.opportunities.options'
        ? { query, selectedUserId: value || undefined } : { ...JSON.parse(inputKey), filters: query ? { query } : {}, limit: SEARCH_LIMIT })
      if (id !== requestId.current) return
      const list = action === 'mip.admin.opportunities.options' ? payload.owners : payload.items
      const items = Array.isArray(list) ? list : []
      setOptions(items.map(item => {
        const user = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const userId = String(user.id || user.userId || '')
        return { value: userId, label: String(user.nickname || user.name || user.label || '未设置昵称') }
      }).filter(option => option.value))
    }
    catch {
      if (id === requestId.current) setFailed(true)
    }
    finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [request, action, value, inputKey])

  useEffect(() => {
    const initial = setTimeout(() => void load(''), 0)
    return () => {
      clearTimeout(initial)
      requestId.current += 1
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  const merged = useMemo(() => {
    if (value && !options.some(option => option.value === value)) return [{ value, label: '已选用户（等待资料核对）' }, ...options]
    return options
  }, [options, value])

  return (
    <Select
      id={id}
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
