import { useParams } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm } from '../../modules/content-mutation-forms'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'
import { defaultContentFormValues } from './content-form-helpers'
import { knowledgeEditorInput, knowledgeEditorValues } from '../../modules/knowledge-editor'

export function KnowledgeEditFormPage() {
  const params = useParams({ from: '/knowledge/$contentId/edit' }) as { contentId?: string }
  const contentId = params.contentId === 'new' ? '' : (params.contentId || '')
  const { request } = useAdminSession()
  const idempotencyKey = useMemo(
    () => `web-knowledge-contents-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const formDef = useMemo(() => getContentMutationForm('mip.admin.knowledge.contents.save'), [])
  const fields = useMemo(() => (formDef.fields as readonly OperationField[]).map(field => ['contentId', 'expectedVersion'].includes(String(field.key)) ? { ...field, hidden: true } : field), [formDef.fields])
  const values = useMemo(() => defaultContentFormValues(fields), [fields])

  const formConfig: IndependentFormPageConfig = {
    title: contentId ? '编辑知识内容' : '新建知识内容',
    description: '填写知识内容信息、分类和访问范围。提交后由服务端校验权限和审核状态。',
    fields,
    values: { ...values, contentId },
    backTarget: '/knowledge',
    action: 'mip.admin.knowledge.contents.save',
    idempotencyKey,
    capability: 'knowledge.manage',
    buildInput: (submitted: OperationValues) => {
      const merged = { ...values, ...submitted, contentId }
      const result = knowledgeEditorInput(merged)
      return result.ok ? { ok: true, input: result.input } : { ok: false, errors: { ...result.errors } }
    },
  }

  const loadDetail = useCallback(async (): Promise<OperationValues | null> => {
    if (!contentId) return null
    const data = await request<Record<string, unknown>>('mip.admin.knowledge.get', { contentId })
    return knowledgeEditorValues(data)
  }, [contentId, request])

  return <IndependentFormPage config={formConfig} loadDetail={contentId ? loadDetail : undefined} />
}
