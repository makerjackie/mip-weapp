import { useParams } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import type { OperationValues } from '../../modules/admin-operation-ui'
import { createTaskMutationDefinition, buildTaskMutationInput, loadTaskEligibleLevels } from '../../modules/admin-task-management'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'

type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

export function TaskEditFormPage() {
  const params = useParams({ from: '/tasks/$taskId/edit' }) as { taskId?: string }
  const taskId = params.taskId === 'new' ? '' : (params.taskId || '')
  const { request } = useAdminSession()
  const idempotencyKey = useMemo(
    () => `web-tasks-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const baseDefinition = useMemo(
    () => createTaskMutationDefinition('mip.admin.tasks.save', taskId, {}),
    [taskId],
  )

  const formConfig: IndependentFormPageConfig = {
    title: taskId ? '编辑任务' : '创建任务',
    description: '填写任务内容、经验奖励、参与范围和截止时间。任务模板图片可使用素材上传页返回的素材 ID。',
    fields: baseDefinition.fields,
    values: baseDefinition.values,
    backTarget: '/tasks',
    action: 'mip.admin.tasks.save',
    idempotencyKey,
    capability: 'tasks.manage',
    buildInput: (values: OperationValues) => buildTaskMutationInput(
      { ...baseDefinition, values: { ...baseDefinition.values, ...values } },
      values,
    ),
  }

  const loadDetail = async (): Promise<OperationValues | null> => {
    const eligibleLevelCatalog = await loadTaskEligibleLevels(request as AdminRequest)
    if (!taskId) return { eligibleLevelCatalog } as OperationValues
    const taskValue = await request<Record<string, unknown>>('mip.admin.tasks.get', { taskId })
    const task = taskValue && typeof taskValue === 'object' ? taskValue : {}
    const definition = createTaskMutationDefinition('mip.admin.tasks.save', taskId, { task, eligibleLevelCatalog })
    return { ...definition.values, eligibleLevelCatalog } as OperationValues
  }

  return <IndependentFormPage config={formConfig} loadDetail={loadDetail} />
}
