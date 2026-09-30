import { useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import type { OperationValues } from '../../modules/admin-operation-ui'
import { createAdminEventMutationDefinition, validateAdminEventMutationInput, EVENT_MUTATION_CONFIGS } from '../../modules/admin-event-mutation-forms'
import { loadEventDetailForForm } from './event-form-loader'
import { EventMobilePreview } from './event-mobile-preview'
import { eventPrivateDrafts } from '../../modules/event-private-drafts'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'

type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

export function EventEditFormPage() {
  const params = useParams({ from: '/events/$eventId/edit' }) as { eventId?: string }
  const eventId = params.eventId === 'new' ? '' : (params.eventId || '')
  const { draftId } = useSearch({ from: '/events/$eventId/edit' }) as { draftId?: string }
  const { request } = useAdminSession()
  const drafts = useMemo(() => eventPrivateDrafts(request, eventId), [request, eventId])

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
    fields: definition.fields.map(field => ({ ...field,
      ...(field.key === 'priceCents' ? { kind: 'money', valueScale: 100, label: '金额（元）' } : {}),
      ...(field.key === 'branchId' ? { label: '服务器', optionsAction: 'mip.admin.branches.list', optionsInput: { purpose: 'EVENT_EDIT' }, visibleWhen: { path: 'scopeType', value: 'BRANCH' } } : {}),
      ...(field.key === 'eventTypeKey' ? { label: '活动类型', optionsAction: 'mip.admin.events.catalog.list', optionsInput: { kind: 'TYPE', selectable: true }, optionsValueKey: 'key' } : {}),
      ...(field.key === 'onlineUrl' ? { visibleWhen: { path: 'eventMode', value: ['ONLINE', 'HYBRID'] } } : {}),
    })),
    values: definition.values,
    backTarget: '/events',
    action: 'mip.admin.events.save',
    idempotencyKey,
    capability: config.capability,
    privateDraft: { ...drafts, load: () => drafts.load(draftId) },
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
      render: (values) => <EventMobilePreview values={values} />,
      capability: config.capability,
    },
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
