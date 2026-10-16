import { App, Input, Modal, Select, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { createAdminEventMutationDefinition, validateAdminEventMutationInput } from '../../modules/admin-event-mutation-forms'
import type { AdminOperationAction } from '../../domain/contracts'
import type { AdminRequestInput } from '../../domain/contracts'

interface UserOption {
  value: string
  label: string
}

/**
 * 演示模式没有后端目录，返回一小组样例选项，仅用于本地视觉评审（与原型示例一致）。
 * 真实运行永远走后端目录；此处不会影响生产。
 */
function demoCatalogOptions(action: string, input: Record<string, unknown>): UserOption[] {
  if (action !== 'mip.admin.events.catalog.list') return []
  const kind = String(input.kind || '')
  if (kind === 'TAG') return ['早会', '集会', '沙龙', '路演'].map(name => ({ value: name, label: name }))
  if (kind === 'TYPE') return ['早会', '沙龙', '路演', '工作坊'].map(name => ({ value: name, label: name }))
  return []
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
  variant,
  allowCreate,
  createKind,
  createMaxLength,
  filter,
  input,
  valueKey,
  emptyHint,
}: {
  id?: string
  action: string
  value?: string | string[]
  onChange?: (value: string | string[]) => void
  disabled?: boolean
  placeholder?: string
  optionsKey?: string
  multiple?: boolean
  /** Pills render a selectable chip group instead of a dropdown (原型活动标签样式). */
  variant?: 'select' | 'pills'
  /** Pills only: show「＋ 新建」to create a catalog entry inline. */
  allowCreate?: boolean
  createKind?: string
  createMaxLength?: number
  filter?: { key: string; value: string }
  input?: AdminRequestInput
  valueKey?: string
  /** Shown when the catalog loads but has no entries, telling operators where options come from. */
  emptyHint?: string
}) {
  const { request, demoMode, hasCapability } = useAdminSession()
  const { message } = App.useApp()
  const [options, setOptions] = useState<UserOption[]>([])
  const [failed, setFailed] = useState(false)
  const [policyDisabled, setPolicyDisabled] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const filterKey = filter?.key, filterValue = filter?.value
  const inputKey = JSON.stringify(input || {})
  const canCreate = Boolean(allowCreate) && hasCapability?.('events.catalog.manage') === true

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      if (demoMode) {
        // 演示模式：直接给样例选项，避免本地预览显示“目录加载失败”（真实运行永远走后端目录）。
        if (!active) return
        setOptions(demoCatalogOptions(action, JSON.parse(inputKey) as Record<string, unknown>))
        setFailed(false)
        setPolicyDisabled(false)
        return
      }
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
  }, [action, optionsKey, request, demoMode, filterKey, filterValue, inputKey, valueKey, reloadKey])

  const merged = useMemo(() => {
    const values = Array.isArray(value) ? value : value ? [value] : []
    return [...values.filter(item => !options.some(option => option.value === item)).map(item => ({ value: item, label: '已选项（等待目录核对）' })), ...options]
  }, [options, value])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) { setCreateError('请输入名称'); return }
    if (createMaxLength && name.length > createMaxLength) { setCreateError(`名称不能超过 ${createMaxLength} 个字`); return }
    if (merged.some(option => option.label === name)) { setCreateError('该名称已存在，请直接选择'); return }
    if (demoMode) { setCreateError('演示模式不会新建标签'); return }
    setCreating(true)
    setCreateError('')
    const kind = createKind || 'TAG'
    try {
      const definition = createAdminEventMutationDefinition('mip.admin.events.catalog.save', '')
      const built = validateAdminEventMutationInput(definition, { kind, name })
      if (!built.ok) { setCreateError(built.errors[0]?.message || '名称无效'); return }
      const created = await request<Record<string, unknown>>('mip.admin.events.catalog.save', {
        ...(built.input as Record<string, unknown>),
        idempotencyKey: `web-catalog-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      })
      const createdId = String(created?.id || created?.catalogId || '')
      const createdVersion = Number(created?.version)
      // 服务端新建目录项默认 INACTIVE；立即启用才能出现在可选项里并用于当前活动（原型「新建并选中」）。
      if (createdId && Number.isInteger(createdVersion)) {
        await request('mip.admin.events.catalog.changeStatus', {
          kind,
          catalogId: createdId,
          expectedVersion: createdVersion,
          status: 'ACTIVE',
          idempotencyKey: `web-catalog-activate-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        })
      }
      setCreateOpen(false)
      setNewName('')
      setReloadKey(current => current + 1)
      if (createdId) {
        const current = Array.isArray(value) ? value : value ? [value] : []
        onChange?.(multiple ? [...current, createdId] : createdId)
      }
      void message.success('已新建并选中')
    }
    catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : '新建失败，请重试')
    }
    finally {
      setCreating(false)
    }
  }

  if (variant === 'pills') {
    const values = Array.isArray(value) ? value : value ? [value] : []
    const createLabel = createKind === 'TYPE' ? '＋ 新建类型' : '＋ 新建标签'
    return (
      <>
        <div className="catalog-pills" id={id} role="group">
          {failed ? <span className="catalog-pills__hint">目录加载失败，请稍后重试</span> : null}
          {!failed && !merged.length ? <span className="catalog-pills__hint">{emptyHint || '暂无可选项'}</span> : null}
          {!failed && merged.map(option => {
            const active = values.includes(option.value)
            return (
              <button
                type="button"
                key={option.value}
                className={`catalog-pill${active ? ' is-active' : ''}`}
                aria-pressed={active}
                disabled={disabled || policyDisabled}
                onClick={() => {
                  if (disabled || policyDisabled) return
                  if (!multiple) {
                    onChange?.(active ? '' : option.value)
                    return
                  }
                  onChange?.(active ? values.filter(item => item !== option.value) : [...values, option.value])
                }}
              >
                {option.label}
              </button>
            )
          })}
          {canCreate ? (
            <button
              type="button"
              className="catalog-pill catalog-pill--create"
              disabled={disabled || policyDisabled}
              onClick={() => { setCreateOpen(true); setCreateError('') }}
            >
              {createLabel}
            </button>
          ) : null}
        </div>
        {canCreate ? (
          <Modal
            title={createLabel.replace('＋ ', '新建')}
            open={createOpen}
            onCancel={() => setCreateOpen(false)}
            onOk={() => void handleCreate()}
            okText="新建并选中"
            cancelText="取消"
            confirmLoading={creating}
            destroyOnHidden
          >
            <Input
              value={newName}
              maxLength={createMaxLength}
              placeholder={createMaxLength ? `名称（不超过 ${createMaxLength} 个字）` : '名称'}
              onChange={event => setNewName(event.target.value)}
              onPressEnter={() => void handleCreate()}
            />
            {createError ? <div className="catalog-pills__hint" style={{ color: '#ff4d4f', marginTop: 8 }}>{createError}</div> : null}
          </Modal>
        ) : null}
      </>
    )
  }

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
      notFoundContent={failed ? '目录加载失败，请稍后重试' : options.length === 0 && emptyHint ? emptyHint : '暂无可选项'}
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
  multiple = false,
}: {
  id?: string
  value?: string | string[]
  onChange?: (value: string | string[]) => void
  multiple?: boolean
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
        ? { query, selectedUserId: typeof value === 'string' ? value || undefined : undefined } : action === 'mip.admin.messageCampaigns.recipients'
          ? { ...JSON.parse(inputKey), query, limit: SEARCH_LIMIT } : { ...JSON.parse(inputKey), filters: query ? { query } : {}, limit: SEARCH_LIMIT })
      if (id !== requestId.current) return
      const list = action === 'mip.admin.opportunities.options' ? payload.owners : payload.items
      const items = Array.isArray(list) ? list : []
      setOptions(items.map(item => {
        const user = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const userId = String(action === 'mip.admin.messageCampaigns.recipients' ? user.profileRef || '' : user.id || user.userId || '')
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
    const selected = Array.isArray(value) ? value : value ? [value] : []
    return [...selected.filter(item => !options.some(option => option.value === item)).map(item => ({ value: item, label: '已选用户（等待资料核对）' })), ...options]
  }, [options, value])

  return (
    <Select
      id={id}
      mode={multiple ? 'multiple' : undefined}
      showSearch
      value={value || undefined}
      placeholder={placeholder}
      disabled={disabled}
      filterOption={false}
      allowClear
      notFoundContent={loading ? <Spin size="small" /> : failed ? '用户搜索暂不可用' : '没有匹配的用户'}
      options={merged}
      onChange={next => onChange?.(next || (multiple ? [] : ''))}
      onSearch={query => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(query.trim()), 300)
      }}
    />
  )
}
