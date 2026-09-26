import { useParams } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm, validateContentMutation } from '../../modules/content-mutation-forms'
import { contentFormValues, normalizeContentFields } from '../../modules/content-form-values'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'
import { defaultContentFormValues } from './content-form-helpers'

export function OpportunityEditFormPage() {
  const params = useParams({ from: '/opportunities/$opportunityId/edit' }) as { opportunityId?: string }
  const opportunityId = params.opportunityId === 'new' ? '' : (params.opportunityId || '')
  const { request } = useAdminSession()
  const idempotencyKey = useMemo(
    () => `web-opportunities-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const formDef = getContentMutationForm('mip.admin.opportunities.save')
  const fields = useMemo(() => normalizeContentFields(formDef.fields as readonly OperationField[]), [formDef.fields])
  const values = useMemo(() => defaultContentFormValues(fields), [fields])

  const formConfig: IndependentFormPageConfig = {
    title: opportunityId ? '编辑机会' : '创建机会',
    description: '填写机会信息、商业条件和合作角色。提交后由服务端校验权限和状态。',
    fields,
    values: { ...values, opportunityId },
    backTarget: '/opportunities',
    action: 'mip.admin.opportunities.save',
    idempotencyKey,
    capability: 'opportunities.moderate',
    buildInput: (submitted: OperationValues) => {
      const merged = { ...values, ...submitted, opportunityId }
      const result = validateContentMutation('mip.admin.opportunities.save', contentFormValues('mip.admin.opportunities.save', merged, idempotencyKey))
      return result.ok ? result.input : null
    },
  }

  const loadDetail = opportunityId
    ? async (): Promise<OperationValues | null> => {
        const data = await request<Record<string, unknown>>('mip.admin.opportunities.get', { opportunityId })
        if (!data || typeof data !== 'object') return null
        const opp = data as Record<string, unknown>
        const draft = (opp.draft && typeof opp.draft === 'object' ? opp.draft : {}) as Record<string, unknown>
        return {
          opportunityId: String(opp.id || opportunityId),
          expectedVersion: Number(opp.version) || undefined,
          draft: { ...draft },
        } as OperationValues
      }
    : undefined

  return <IndependentFormPage config={formConfig} loadDetail={loadDetail} />
}
