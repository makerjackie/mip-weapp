import { useParams } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'
import { getContentMutationForm, validateContentMutation } from '../../modules/content-mutation-forms'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'
import { defaultContentFormValues } from './content-form-helpers'

export function KnowledgeEditFormPage() {
  const params = useParams({ from: '/knowledge/$contentId/edit' }) as { contentId?: string }
  const contentId = params.contentId === 'new' ? '' : (params.contentId || '')
  const { request } = useAdminSession()
  const idempotencyKey = useMemo(
    () => `web-knowledge-contents-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const formDef = getContentMutationForm('mip.admin.knowledge.contents.save')
  const fields = formDef.fields as readonly OperationField[]
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
      const result = validateContentMutation('mip.admin.knowledge.contents.save', merged)
      return result.ok ? result.input : null
    },
  }

  const loadDetail = contentId
    ? async (): Promise<OperationValues | null> => {
        const data = await request<Record<string, unknown>>('mip.admin.knowledge.get', { contentId })
        if (!data || typeof data !== 'object') return null
        const content = data as Record<string, unknown>
        return {
          contentId: String(content.id || contentId),
          expectedVersion: Number(content.version) || undefined,
          sourceId: String(content.sourceId || ''),
          categoryId: String(content.categoryId || ''),
          contentType: String(content.contentType || 'ARTICLE'),
          title: String(content.title || ''),
          summary: String(content.summary || ''),
          bodyText: String(content.bodyText || ''),
          externalUrl: String(content.externalUrl || ''),
          channelFinderUserName: String(content.channelFinderUserName || ''),
          channelFeedId: String(content.channelFeedId || ''),
          coverAssetId: String(content.coverAssetId || ''),
          authorName: String(content.authorName || ''),
          accessType: String(content.accessType || 'FREE'),
          commentsEnabled: content.commentsEnabled !== false,
          moderationMode: String(content.moderationMode || 'AUTO'),
        } as OperationValues
      }
    : undefined

  return <IndependentFormPage config={formConfig} loadDetail={loadDetail} />
}
