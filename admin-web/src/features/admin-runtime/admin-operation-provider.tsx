import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput } from '../../domain/contracts'
import type { AdminDetailView } from '../../modules/admin-details'
import {
  createMutationDefinition,
  mutationInput,
  type MutationState,
  type MutationValues,
} from '../../modules/admin-mutation-ui'
import { createMutationIntent, type AdminMutationAction } from '../../modules/admin-mutations'
import { normalizeOperationValues, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'
import type { AdminOperationLaunchContext } from '../../modules/admin-row-operations'
import { ConfirmDialog, MutationDialog } from '../../shared/ui'
import {
  createOperationModel,
  isReviewedOperationAction,
  operationCapability,
  type ReviewedOperationAction,
} from './operation-model'

const basicActions = new Set<string>([
  'mip.admin.memberships.grant',
  'mip.admin.events.clone',
  'mip.admin.events.changeStatus',
  'mip.admin.events.archive',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.refunds.submit',
])

type LaunchOptions = AdminOperationLaunchContext & {
  targetStatus?: 'PUBLISHED' | 'UNPUBLISHED'
}

interface DialogModel {
  action: string
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
  const { demoMode, hasCapability, request } = useAdminSession()
  const [model, setModel] = useState<DialogModel | null>(null)
  const [pendingValues, setPendingValues] = useState<OperationValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const launch = useCallback(async (
    action: string,
    targetId = '',
    detail: AdminDetailView | null = null,
    options: LaunchOptions = {},
  ) => {
    setError('')
    setPendingValues(null)
    try {
      const next = basicActions.has(action)
        ? createBasicModel(action as AdminMutationAction, targetId, detail, options.targetStatus)
        : isReviewedOperationAction(action)
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
      setModel(next)
    }
    catch (reason) {
      void message.error(reason instanceof Error ? reason.message : '操作表单暂时无法加载')
    }
  }, [hasCapability, message, request])

  const close = useCallback(() => {
    if (loading) return
    setModel(null)
    setPendingValues(null)
    setError('')
  }, [loading])

  const prepare = useCallback((submitted: OperationValues) => {
    if (!model) return
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
      await queryClient.invalidateQueries()
      void message.success(`${model.title}已提交`)
      setModel(null)
      setPendingValues(null)
    }
    catch (reason) {
      setPendingValues(null)
      setError(reason instanceof Error ? reason.message : '请求结果暂时无法确认')
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

function createBasicModel(
  action: AdminMutationAction,
  targetId: string,
  detail: AdminDetailView | null,
  targetStatus?: 'PUBLISHED' | 'UNPUBLISHED',
): DialogModel {
  const readField = (sectionTitle: string, label: string) => detail?.sections
    .find(section => section.title === sectionTitle)?.fields
    ?.find(field => field.label === label)?.value || ''
  const definition = createMutationDefinition(action, targetId, readField, targetStatus)
  const intent = createMutationIntent(action, definition.values)
  const state: MutationState = { ...definition, intent, error: '', busy: false }
  return {
    action,
    title: definition.title,
    description: definition.description,
    capability: basicCapability(action),
    fields: basicFields(action),
    values: definition.values,
    idempotencyKey: intent.idempotencyKey,
    buildInput: values => mutationInput(state, values as MutationValues),
  }
}

function basicFields(action: AdminMutationAction): OperationField[] {
  if (action === 'mip.admin.memberships.grant') return [
    { name: 'expectedChainVersion', label: '会员链版本', kind: 'number', hidden: true },
    { name: 'durationMonths', label: '会员时长', kind: 'select', required: true, options: [
      { value: '1', label: '1 个月' }, { value: '3', label: '3 个月' },
      { value: '6', label: '6 个月' }, { value: '12', label: '12 个月' },
    ] },
    { name: 'reason', label: '调整原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
  ]
  if (action === 'mip.admin.events.archive') return [
    { name: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
    { name: 'reason', label: '归档原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
  ]
  if (action === 'mip.admin.communications.publishEventReminder') return [
    { name: 'expectedVersion', label: '版本', kind: 'number', hidden: true },
    { name: 'sendWechatReminder', label: '同时生成微信提醒任务', kind: 'checkbox', wide: true },
  ]
  if (action === 'mip.admin.refunds.submit') return [
    { name: 'reason', label: '退款原因', kind: 'textarea', required: true, maxLength: 300, wide: true },
  ]
  return [{ name: 'expectedVersion', label: '版本', kind: 'number', hidden: true }]
}

function basicCapability(action: AdminMutationAction) {
  if (action === 'mip.admin.memberships.grant') return 'memberships.adjust'
  if (action === 'mip.admin.refunds.submit') return 'refunds.submit'
  if (action === 'mip.admin.communications.publishEventReminder') return 'communications.publish'
  return 'events.write'
}

export function reviewedCapability(action: ReviewedOperationAction) {
  return operationCapability(action)
}
