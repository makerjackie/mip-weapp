import { useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm, validateContentMutation } from '../../modules/content-mutation-forms'
import { contentFormValues } from '../../modules/content-form-values'
import { userContentEditorFields, userContentEditorValues } from '../../modules/user-content-editor'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'
import { defaultContentFormValues } from './content-form-helpers'

export function UserContentEditFormPage() {
  const params = useParams({ from: '/userContent/$contentId/edit' }) as { contentId?: string }
  const search = useSearch({ from: '/userContent/$contentId/edit' }) as { kind?: string }
  const rawContentId = params.contentId || ''
  const isNew = rawContentId === 'new' || !rawContentId
  const initialKind = search.kind === 'SUPER_CASE' ? 'SUPER_CASE' : 'COOPERATION_CARD'
  const { request } = useAdminSession()
  const idempotencyKey = useMemo(
    () => `web-userContent-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const formDef = getContentMutationForm('mip.admin.userContent.save')
  const fields = useMemo(() => userContentEditorFields(formDef.fields as readonly OperationField[], !isNew), [formDef.fields, isNew])
  const baseValues = useMemo(() => defaultContentFormValues(fields), [fields])
  const values = useMemo(() => ({ ...baseValues, kind: initialKind }), [baseValues, initialKind])

  const formConfig: IndependentFormPageConfig = {
    title: isNew ? '创建用户内容' : '编辑用户内容',
    description: '填写合作卡或超级案例内容。角色信息和能力评分根据内容类型动态展示。',
    fields,
    values,
    backTarget: '/opportunities',
    action: 'mip.admin.userContent.save',
    idempotencyKey,
    capability: 'userContent.moderate',
    buildInput: (submitted: OperationValues) => {
      const merged = { ...values, ...submitted }
      const result = validateContentMutation('mip.admin.userContent.save', contentFormValues('mip.admin.userContent.save', merged, idempotencyKey))
      return result.ok ? { ok: true, input: result.input } : { ok: false, errors: { ...result.errors } }
    },
  }

  const loadDetail = useCallback(async (): Promise<OperationValues | null> => {
    if (isNew) return null
    const separator = rawContentId.indexOf(':')
    const kind = separator > 0 ? rawContentId.slice(0, separator) : ''
    const contentId = separator > 0 ? rawContentId.slice(separator + 1) : rawContentId
    if (!['COOPERATION_CARD', 'SUPER_CASE'].includes(kind) || !contentId) throw new Error('用户内容地址无效，请从列表重新打开。')
    const data = await request<unknown>('mip.admin.userContent.get', { kind, contentId })
    return userContentEditorValues(data)
  }, [isNew, rawContentId, request])

  return <IndependentFormPage config={formConfig} loadDetail={isNew ? undefined : loadDetail} />
}
