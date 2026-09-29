import { useParams } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm, validateContentMutation } from '../../modules/content-mutation-forms'
import { contentFormValues, normalizeContentFields } from '../../modules/content-form-values'
import { opportunityEditorValues } from '../../modules/opportunity-editor'
import { opportunityTextSuggestions } from '../../modules/opportunity-text-assist'
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
  const fields = useMemo(() => {
    const optionsAction = 'mip.admin.opportunities.options'
    const enhance = (items: readonly OperationField[]): readonly OperationField[] => items.map(field => {
      const key = String(field.key || '')
      return { ...field, ...(field.fields ? { fields: enhance(field.fields) } : {}),
        ...(['opportunityId', 'expectedVersion', 'cityTagId'].includes(key) ? { hidden: true } : {}),
        ...(key === 'ownerUserId' ? { remoteUserSearch: true, userSearchAction: optionsAction } : {}),
        ...(key === 'branchId' ? { optionsAction, optionsKey: 'branches' } : {}),
        ...(key === 'tagIds' ? { kind: 'multi-select', optionsAction, optionsKey: 'tags' } : {}),
        ...(key === 'roleKeys' ? { options: [{ value: 'connector', label: '皮条客' }, { value: 'business_builder', label: '生意佬' }, { value: 'capital_operator', label: '暴发户' }, { value: 'strategist', label: '狗策划' }, { value: 'visual_designer', label: '死美工' }, { value: 'delivery_lead', label: '老保姆' }] } : {}),
        ...(['minAmountCents', 'maxAmountCents'].includes(key) ? { kind: 'money', valueScale: 1000000, label: key === 'minAmountCents' ? '最低价值（万元）' : '最高价值（万元）' } : {}),
        ...(key === 'locations' ? { kind: 'commercial-locations', fields: undefined, required: false } : {}),
      }
    })
    return enhance(normalizeContentFields(formDef.fields as readonly OperationField[]))
  }, [formDef.fields])
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
    textAssist: { suggest: opportunityTextSuggestions },
    buildInput: (submitted: OperationValues) => {
      const merged = { ...values, ...submitted, opportunityId }
      const result = validateContentMutation('mip.admin.opportunities.save', contentFormValues('mip.admin.opportunities.save', merged, idempotencyKey))
      return result.ok ? { ok: true, input: result.input } : { ok: false, errors: { ...result.errors } }
    },
  }

  const loadDetail = useCallback(async (): Promise<OperationValues | null> => {
    if (!opportunityId) return null
    const data = await request<Record<string, unknown>>('mip.admin.opportunities.get', { opportunityId })
    return opportunityEditorValues(data)
  }, [opportunityId, request])

  return <IndependentFormPage key={opportunityId || 'new'} config={formConfig} loadDetail={opportunityId ? loadDetail : undefined} />
}
