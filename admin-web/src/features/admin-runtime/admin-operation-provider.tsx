import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'
import type { AdminDetailView } from '../../modules/admin-details'
import { normalizeOperationValues, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import type { AdminOperationLaunchContext } from '../../modules/admin-row-operations'
import { ConfirmDialog, MutationDialog } from '../../shared/ui'
import {
  createOperationModel,
  isReviewedOperationAction,
} from './operation-model'

type LaunchOptions = AdminOperationLaunchContext & {
  targetStatus?: 'PUBLISHED' | 'UNPUBLISHED'
}

interface DialogModel {
  draftKey: string
  needsReload?: boolean
  action: AdminOperationAction
  title: string
  description: string
  capability: string
  fields: readonly OperationField[]
  values: OperationValues
  idempotencyKey: string
  buildInput: (values: OperationValues) => AdminRequestInput | null
}

interface OperationContextValue {
  launch: (
    action: string,
    targetId?: string,
    detail?: AdminDetailView | null,
    options?: LaunchOptions,
  ) => Promise<void>
}

const OperationContext = createContext<OperationContextValue | null>(null)

export function AdminOperationProvider({ children }: { children: ReactNode }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { demoMode, hasCapability, request, sessionBoundary } = useAdminSession()
  const [model, setModel] = useState<DialogModel | null>(null)
  const [pendingValues, setPendingValues] = useState<OperationValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const conflictDrafts = useRef(new Map<string, OperationValues>())

  const launch = useCallback(async (
    action: string,
    targetId = '',
    detail: AdminDetailView | null = null,
    options: LaunchOptions = {},
  ) => {
    setError('')
    setPendingValues(null)
    try {
      const next = isReviewedOperationAction(action)
        ? await createOperationModel(action, targetId, detail, options, request)
        : null
      if (!next) {
        void message.error('当前操作尚未接入受控表单')
        return
      }
      if (!hasCapability(next.capability)) {
        void message.error('当前账号没有执行此操作的权限')
        return
      }
      const resourceIds = Object.entries(next.values).filter(([key]) => /Id$/.test(key)).sort(([left], [right]) => left.localeCompare(right))
      const draftKey = JSON.stringify([sessionBoundary, action, targetId, resourceIds])
      const saved = conflictDrafts.current.get(draftKey)
      const values = { ...next.values }
      if (saved) {
        for (const field of next.fields) {
          const key = String(field.name || field.key || '')
          if (!field.hidden && !/version/i.test(key) && !/Id$/.test(key) && Object.hasOwn(saved, key)) values[key] = saved[key]
        }
        setError('已保留上次填写内容，请核对最新记录后重新提交。')
      }
      setModel({ ...next, draftKey, values })
    }
    catch (reason) {
      void message.error(reason instanceof Error ? reason.message : '操作表单暂时无法加载')
    }
  }, [hasCapability, message, request, sessionBoundary])

  const close = useCallback(() => {
    if (loading) return
    setModel(null)
    setPendingValues(null)
    setError('')
  }, [loading])

  const prepare = useCallback((submitted: OperationValues) => {
    if (!model) return
    if (model.needsReload) {
      setError('记录已更新，请重新打开操作后核对。填写内容已保留。')
      return
    }
    const values = normalizeOperationValues(model.fields, submitted, model.values)
    if (!model.buildInput(values)) {
      setError('请检查必填项、标识、版本和字段格式')
      return
    }
    setModel({ ...model, values })
    setError('')
    setPendingValues(values)
  }, [model])

  const submit = useCallback(async () => {
    if (!model || !pendingValues || loading) return
    if (demoMode) {
      void message.info('演示模式不会提交写操作')
      setModel(null)
      setPendingValues(null)
      return
    }
    const input = model.buildInput(pendingValues)
    if (!input) return
    setLoading(true)
    setError('')
    try {
      await request(model.action, { ...input, idempotencyKey: model.idempotencyKey })
      conflictDrafts.current.delete(model.draftKey)
      await queryClient.invalidateQueries()
      void message.success(`${model.title}已提交`)
      setModel(null)
      setPendingValues(null)
    }
    catch (reason) {
      setPendingValues(null)
      if (reason && typeof reason === 'object' && 'code' in reason
        && (reason.code === 'CONFLICT' || reason.code === 'VERSION_CONFLICT')) {
        conflictDrafts.current.set(model.draftKey, model.values)
        setModel({ ...model, needsReload: true })
        await queryClient.invalidateQueries()
        setError('记录已更新，列表已刷新。填写内容已保留，请重新打开操作后核对。')
      }
      else setError(reason instanceof Error ? reason.message : '请求结果暂时无法确认')
    }
    finally { setLoading(false) }
  }, [demoMode, loading, message, model, pendingValues, queryClient, request])

  const value = useMemo<OperationContextValue>(() => ({ launch }), [launch])
  return (
    <OperationContext.Provider value={value}>
      {children}
      <MutationDialog
        open={Boolean(model) && !pendingValues}
        title={model?.title || '运营操作'}
        description={model?.description || ''}
        fields={model?.fields || []}
        values={model?.values || {}}
        loading={loading}
        error={error}
        onSubmit={prepare}
        onCancel={close}
      />
      <ConfirmDialog
        open={Boolean(model && pendingValues)}
        title={model?.title || '确认操作'}
        description="服务端会再次校验权限、作用范围、资源状态和当前版本。"
        confirmText="确认提交"
        danger={Boolean(model?.action.includes('delete') || model?.action.includes('archive') || model?.action.includes('refund'))}
        loading={loading}
        onConfirm={() => void submit()}
        onCancel={() => setPendingValues(null)}
      />
    </OperationContext.Provider>
  )
}

export function useAdminOperations() {
  const value = useContext(OperationContext)
  if (!value) throw new Error('useAdminOperations must be used within AdminOperationProvider')
  return value
}
