import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('event cancel convergence contract', () => {
  it('exposes cancelEvent action and rejects generic CANCELLED status transitions', () => {
    const adminApi = read('cloudfunctions/membership-admin-api/index.js')
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
    const adminTypes = read('src/modules/admin/types.ts')
    const adminGateway = read('src/modules/admin/cloudbase-gateway.ts')
    const adminClient = read('src/modules/admin/client.ts')
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(workflows).toContain('async function cancelEvent')
    expect(workflows).toContain('cancelled_by_type = \'EVENT\'')
    expect(workflows).toContain('status = \'REGISTERED\'')
    expect(workflows).toContain('EVENT_CANCELLED')
    expect(workflows).toContain('affectedCount')
    expect(workflows).toContain('EVENT_CANCEL_REQUIRES_ACTION')
    expect(adminApi).toContain('cancelEvent:')
    expect(adminApi).toContain('expectedVersion')
    expect(adminApi).toContain('INVALID_CANCELLATION_REASON')
    expect(adminTypes).toContain('cancelEvent:')
    expect(adminTypes).toContain('AdminEventCancelResult')
    expect(adminGateway).toContain('\'cancelEvent\'')
    expect(adminClient).toContain('cancelEvent(')
    expect(adminClient).toContain('membershipModule.invalidateEventCaches()')
    expect(pageTs).toContain('confirmCancelEvent')
    expect(pageTs).toContain('adminModule.cancelEvent')
    expect(pageTs).toContain('cancelConflict')
    expect(pageTs).toContain('refreshAfterCancelConflict')
    expect(pageTs).not.toContain('setEventStatus(eventId, \'CANCELLED\')')
    expect(pageTs).not.toContain('data-status="CANCELLED"')
    // Version conflict must not auto-adopt latest version while keeping old reason.
    expect(pageTs).not.toMatch(/cancelEventVersion:\s*latest\.version/)
    expect(pageWxml).toContain('openCancelDialog')
    expect(pageWxml).toContain('取消原因（必填）')
    expect(pageWxml).toContain('refreshAfterCancelConflict')
    expect(pageWxml).not.toContain('data-status="CANCELLED"')
  })

  it('returns member history fields and distinguishes MEMBER vs EVENT cancel copy', () => {
    const membershipApi = read('cloudfunctions/membership-api/index.js')
    const membershipTypes = read('src/modules/membership/types.ts')
    const membershipModule = read('src/modules/membership/module.ts')
    const registrationsTs = read('src/packages/member/registrations/index.ts')
    const registrationsWxml = read('src/packages/member/registrations/index.wxml')
    const ticketTs = read('src/packages/member/ticket/index.ts')
    const detailTs = read('src/packages/member/event-detail/index.ts')

    expect(membershipApi).toContain('publicRegistrationHistory')
    expect(membershipApi).toContain('eventState')
    expect(membershipApi).toContain('registrationState')
    expect(membershipApi).toContain('cancelledByType')
    expect(membershipApi).toContain('cancellationReason')
    expect(membershipApi).toContain('INNER JOIN member_events')
    expect(membershipApi).toContain('e.status = \'PUBLISHED\'')
    expect(membershipApi).toContain('OR EXISTS')
    expect(membershipTypes).toContain('cancelledByType')
    expect(membershipTypes).toContain('eventState')
    expect(membershipModule).toContain('invalidateEventCaches')
    expect(registrationsTs).toContain('主办方已取消')
    expect(registrationsTs).toContain('你已取消')
    expect(registrationsWxml).toContain('item.reasonText')
    expect(ticketTs).toContain('主办方已取消')
    expect(ticketTs).toContain('你已取消报名')
    expect(detailTs).toContain('event-cancelled')
    expect(detailTs).toContain('member-cancelled')
  })

  it('keeps public feeds on PUBLISHED and does not leak operator IDs', () => {
    const membershipApi = read('cloudfunctions/membership-api/index.js')
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')

    expect(membershipApi).toContain('status = \'PUBLISHED\' AND starts_at >= UTC_TIMESTAMP(3)')
    expect(membershipApi).not.toContain('cancelled_by,')
    expect(membershipApi).not.toContain('cancelled_by AS')
    expect(workflows).toContain('JSON.stringify({ affectedCount, refundCount: refundIds.length })')
    expect(workflows).not.toContain('cancelled_by: actorId')
  })
})
