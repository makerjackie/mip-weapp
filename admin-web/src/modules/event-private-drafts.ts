import type { AdminRequest } from './admin-read-contracts'
import type { OperationValues } from './admin-operation-ui'

export function eventPrivateDrafts(request: AdminRequest, eventId: string) {
  let submission: { payload: string; key: string } | null = null
  const parse = (value: unknown): OperationValues | null => {
    if (value === null) return null
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (typeof row.draftId !== 'string' || !Number.isInteger(row.version) || !row.draftData || typeof row.draftData !== 'object' || Array.isArray(row.draftData)) throw new Error('活动草稿字段不完整')
    if ((row.eventId || '') !== eventId) throw new Error('草稿不属于当前活动')
    const fields = Object.fromEntries(Object.entries(row.draftData).filter(([key]) => !key.startsWith('_')))
    return { ...fields, eventId, _draftId: row.draftId, _draftVersion: row.version }
  }
  return {
    load: async (draftId?: string) => parse(await request('mip.admin.events.drafts.get', { eventId: eventId || null, ...(draftId ? { draftId } : {}) })),
    save: async (values: OperationValues) => {
      const draftData = Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('_')))
      const payload = JSON.stringify([values._draftId, values._draftVersion, draftData])
      if (submission?.payload !== payload) submission = { payload, key: `web-event-draft-${crypto.randomUUID()}` }
      const result = await request<Record<string, unknown>>('mip.admin.events.drafts.save', {
        eventId: eventId || null, ...(values._draftId ? { draftId: values._draftId, expectedVersion: values._draftVersion } : {}),
        draftData, idempotencyKey: submission.key,
      })
      return { ...values, _draftId: result.draftId, _draftVersion: result.version }
    },
  }
}
