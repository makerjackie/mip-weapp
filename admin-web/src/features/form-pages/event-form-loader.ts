import type { AdminOperationAction, AdminRequestInput } from '../../domain/contracts'
import type { OperationValues } from '../../modules/admin-operation-ui'

type AdminRequest = <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>

/**
 * Loads the raw event object for the independent edit form.
 * Returns only the fields the form needs to prefill.
 */
export async function loadEventDetailForForm(eventId: string, request: AdminRequest): Promise<OperationValues | null> {
  if (!eventId) return null
  const eventValue = await request<Record<string, unknown>>('mip.admin.events.get', { eventId })
  if (!eventValue || typeof eventValue !== 'object') return null
  const event = eventValue as Record<string, unknown>
  return {
    eventId: String(event.id || eventId),
    expectedVersion: Number(event.version) || undefined,
    scopeType: String(event.scopeType || 'PLATFORM'),
    branchId: String(event.branchId || ''),
    title: String(event.title || ''),
    summary: String(event.summary || ''),
    description: String(event.description || ''),
    contentMedia: Array.isArray(event.contentMedia) ? event.contentMedia : [],
    notices: String(event.notices || ''),
    coverAssetId: String(event.coverAssetId || ''),
    eventTypeKey: String(event.eventTypeKey || 'general'),
    eventMode: String(event.eventMode || 'OFFLINE'),
    accessType: String(event.accessType || 'FREE'),
    registrationPolicy: String(event.registrationPolicy || 'AUTO'),
    albumEnabled: event.albumEnabled !== false,
    albumSubmissionPolicy: String(event.albumSubmissionPolicy || 'REVIEW'),
    startsAt: String(event.startsAt || ''),
    endsAt: String(event.endsAt || ''),
    registrationDeadline: String(event.registrationDeadline || ''),
    cancellationDeadline: String(event.cancellationDeadline || ''),
    venueName: String(event.venueName || ''),
    address: String(event.address || ''),
    cityName: String(event.cityName || ''),
    latitude: event.latitude ?? '',
    longitude: event.longitude ?? '',
    onlineUrl: String(event.onlineUrl || ''),
    capacity: event.capacity ?? '',
    waitlistEnabled: event.waitlistEnabled === true,
    priceCents: String(event.priceCents ?? '0'),
    registrationSchema: Array.isArray(event.registrationSchema) ? event.registrationSchema : [],
  }
}
