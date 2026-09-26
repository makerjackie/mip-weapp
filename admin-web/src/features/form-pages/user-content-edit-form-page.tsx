import { useParams, useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm, validateContentMutation } from '../../modules/content-mutation-forms'
import { contentFormValues } from '../../modules/content-form-values'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'
import { defaultContentFormValues } from './content-form-helpers'

type Record = { [key: string]: unknown }
function asRecord(value: unknown): Record {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record : {}
}

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
  const fields = formDef.fields as readonly OperationField[]
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
      return result.ok ? result.input : null
    },
  }

  const loadDetail = isNew
    ? undefined
    : async (): Promise<OperationValues | null> => {
        const separator = rawContentId.indexOf(':')
        const kind = separator > 0 ? rawContentId.slice(0, separator) : ''
        const contentId = separator > 0 ? rawContentId.slice(separator + 1) : rawContentId
        if (!['COOPERATION_CARD', 'SUPER_CASE'].includes(kind) || !contentId) return null
        const data = await request<unknown>('mip.admin.userContent.get', { kind, contentId })
        const item = asRecord(data)
        const owner = asRecord(item.owner)
        const itemKind = String(item.kind || kind)
        const draft = itemKind === 'COOPERATION_CARD'
          ? {
              kind: itemKind,
              roleKey: item.roleKey,
              positioning: item.positioning,
              targetSummary: item.targetSummary,
              roleFields: item.roleFields,
              abilityScores: item.abilityScores,
              status: item.status,
            }
          : {
              kind: itemKind,
              projectName: item.projectName,
              summary: item.summary,
              startedOn: item.startedOn,
              endedOn: item.endedOn,
              responsibility: item.responsibility,
              cityTagId: item.cityTagId,
              industryTagId: item.industryTagId,
              caseType: item.caseType,
              description: item.description,
              coverAssetId: item.coverAssetId,
              mediaAssetIds: item.mediaAssetIds,
              status: item.status,
            }
        return {
          kind: itemKind,
          contentId: String(item.id || contentId),
          ownerUserId: String(owner.userId || ''),
          expectedVersion: item.version,
          draft,
        } as OperationValues
      }

  return <IndependentFormPage config={formConfig} loadDetail={loadDetail} />
}
