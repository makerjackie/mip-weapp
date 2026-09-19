import { useParams } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminRequestInput, AdminOperationAction } from '../../domain/contracts'
import type { OperationValues } from '../../modules/admin-operation-ui'
import { createAdminEventMutationDefinition, buildAdminEventMutationInput, EVENT_MUTATION_CONFIGS } from '../../modules/admin-event-mutation-forms'
import { loadEventDetailForForm } from './event-form-loader'
import { IndependentFormPage, type IndependentFormPageConfig } from '../form-pages/independent-form-page'

type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

export function EventEditFormPage() {
  const params = useParams({ from: '/events/$eventId/edit' }) as { eventId?: string }
  const eventId = params.eventId === 'new' ? '' : (params.eventId || '')
  const { request } = useAdminSession()

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
    fields: definition.fields as readonly IndependentFormPageConfig['fields'][number][],
    values: definition.values,
    backTarget: '/events',
    action: 'mip.admin.events.save',
    idempotencyKey,
    capability: config.capability,
    buildInput: (values: OperationValues) => buildAdminEventMutationInput(
      { ...definition, values: { ...definition.values, ...values } },
      values,
    ),
  }

  const loadDetail = eventId
    ? () => loadEventDetailForForm(eventId, request as AdminRequest)
    : undefined

  return <IndependentFormPage config={formConfig} loadDetail={loadDetail} />
}
