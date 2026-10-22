import { useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import type { OperationValues } from '../../modules/admin-operation-ui'
import { createAdminEventMutationDefinition, validateAdminEventMutationInput, EVENT_MUTATION_CONFIGS } from '../../modules/admin-event-mutation-forms'
import { loadEventDetailForForm } from './event-form-loader'
import { EventFormFields } from './event-form-fields'
import { EventMobilePreviewWithData } from './event-mobile-preview'
import { eventPrivateDrafts } from '../../modules/event-private-drafts'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'

type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

export function EventEditFormPage() {
  const params = useParams({ from: '/events/$eventId/edit' }) as { eventId?: string }
  const eventId = params.eventId === 'new' ? '' : (params.eventId || '')
  const { draftId } = useSearch({ from: '/events/$eventId/edit' }) as { draftId?: string }
  const { request, demoMode, session } = useAdminSession()
  const drafts = useMemo(() => eventPrivateDrafts(request, eventId), [request, eventId])

  // 归属默认：分会管理员默认选中其所属分会；平台管理员默认「平台（所有分会）」。
  const defaultScope = useMemo(() => {
    const grant = session?.capabilities?.find(item => item.capability === 'events.write' && item.scopeType === 'BRANCH' && item.scopeId)
    return grant?.scopeId
      ? { scopeType: 'BRANCH', branchId: String(grant.scopeId) }
      : { scopeType: 'PLATFORM', branchId: '' }
  }, [session])

  const config = EVENT_MUTATION_CONFIGS['mip.admin.events.save']
  const definition = useMemo(
    () => createAdminEventMutationDefinition('mip.admin.events.save', eventId, () => ''),
    [eventId],
  )

  const idempotencyKey = useMemo(
    () => `web-events-save-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 128),
    [],
  )

  const formConfig: IndependentFormPageConfig = {
    title: eventId ? '编辑活动' : '新建活动',
    description: config.description,
    fields: definition.fields,
    renderFields: (fields, form) => <EventFormFields fields={fields} form={form} />,
    values: { ...definition.values, ...(eventId ? {} : defaultScope) },
    backTarget: '/events',
    action: 'mip.admin.events.save',
    submitLabel: eventId ? '保存活动' : '保存并预览',
    idempotencyKey,
    capability: config.capability,
    // 演示模式没有后端草稿；返回 null 避免本地预览出现“草稿读取失败”噪音。
    privateDraft: { ...drafts, load: () => (demoMode ? Promise.resolve(null) : drafts.load(draftId)) },
    buildInput: (values: OperationValues) => {
      const result = validateAdminEventMutationInput(
        { ...definition, values: { ...definition.values, ...values } },
        values,
      )
      return result.ok
        ? { ok: true, input: { ...result.input, ...(values._draftId ? { editingDraftId: values._draftId, editingDraftVersion: values._draftVersion } : {}) } }
        : { ok: false, errors: Object.fromEntries(result.errors.map(error => [error.field, error.message])) }
    },
    preview: {
      render: (values) => <EventMobilePreviewWithData values={values} />,
      capability: config.capability,
    },
    // 新建保存为草稿后，直接在预览弹窗里提供「发布活动」，省掉“回列表→打开→再发布”。
    // 发布前必须先看到手机预览，符合验收 E03。
    ...(eventId ? {} : {
      publish: {
        action: 'mip.admin.events.changeStatus' as const,
        label: '发布活动',
        doneMessage: '活动已发布',
        buildInput: (result: unknown) => {
          const saved = result && typeof result === 'object' ? result as { id?: unknown, version?: unknown } : {}
          const savedId = typeof saved.id === 'string' ? saved.id : ''
          const version = Number(saved.version)
          return savedId && Number.isInteger(version)
            ? { eventId: savedId, expectedVersion: version, status: 'PUBLISHED' }
            : null
        },
      },
    }),
  }

  const loadDetail = useCallback(async () => {
    if (eventId) return loadEventDetailForForm(eventId, request as AdminRequest)
    const draft = await drafts.load(draftId)
    if (!draft) return null
    if (draft.cloneSourceEventId) {
      const source = await loadEventDetailForForm(String(draft.cloneSourceEventId), request)
      draft._mediaUrls = source?._mediaUrls
    }
    return draft
  }, [eventId, request, drafts, draftId])

  return <IndependentFormPage key={eventId || draftId || 'new'} config={formConfig} loadDetail={eventId || draftId ? loadDetail : undefined} />
}
