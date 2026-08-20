import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('phase9 final gap contracts', () => {
  it('idempotent REGISTERED/ATTENDED path never backfills ticket_code', () => {
    const workflows = read('cloudfunctions/membership-api/lib/workflows.js')
    const adapter = read('cloudfunctions/membership-api/lib/activity-domain-adapter.js')
    const tests = read('cloudfunctions/membership-api/tests/workflows.test.js')

    // Replayable statuses stay in the adapter matrix; REPLAY path is zero-write.
    expect(adapter).toMatch(/REGISTERED:[\s\S]*replayable:\s*true/)
    expect(adapter).toMatch(/ATTENDED:[\s\S]*replayable:\s*true/)
    expect(workflows).toMatch(/enrollment\.kind === 'REPLAY'/)
    expect(workflows).toMatch(/Zero-write fact read/)
    expect(workflows).toMatch(/ticketCode: enrollment\.fact\.ticket_code \|\| ''/)
    // ensureTicketCode must not be called on the REPLAY branch.
    const replayBranch = workflows.slice(
      workflows.indexOf('enrollment.kind === \'REPLAY\''),
      workflows.indexOf('// ACCEPT path'),
    )
    expect(replayBranch).not.toContain('ensureTicketCode')
    expect(replayBranch).not.toMatch(/UPDATE\s+member_registrations/)
    expect(tests).toContain('returns empty ticket without UPDATE when historical REGISTERED ticket_code is empty')
    expect(tests).toContain('returns empty ticket without UPDATE when historical ATTENDED ticket_code is blank')
  })

  it('membership-api vendors activity-domain pure.cjs for CloudBase upload', () => {
    const adapter = read('cloudfunctions/membership-api/lib/activity-domain-adapter.js')
    const vendorPath = path.join(root, 'cloudfunctions/membership-api/lib/vendor/activity-domain/pure.cjs')
    const sourcePath = path.join(root, 'src/shared/activity-domain/pure.cjs')
    const packageHelper = read('scripts/lib/membership-api-package.mjs')
    const verifySource = read('scripts/verify-source.mjs')
    const verifyServer = read('scripts/verify-server.mjs')
    const deploy = read('scripts/deploy-functions.mjs')

    expect(fs.existsSync(vendorPath)).toBe(true)
    expect(fs.readFileSync(vendorPath).equals(fs.readFileSync(sourcePath))).toBe(true)
    const requireCalls = adapter.match(/require\(([^)]+)\)/g) || []
    expect(requireCalls.some(call => call.includes('./vendor/activity-domain/pure.cjs'))).toBe(true)
    for (const call of requireCalls) {
      expect(call).not.toContain('packages/weapp-core')
      expect(call).not.toContain('path.join')
      expect(call).not.toContain('../../../../../')
    }
    expect(packageHelper).toContain('assertMembershipApiActivityDomainPackage')
    expect(packageHelper).toContain('membership-api-isolated-load-ok')
    expect(verifySource).toContain('assertMembershipApiActivityDomainPackage')
    expect(verifyServer).toContain('assertMembershipApiActivityDomainPackage')
    expect(deploy).toContain('assertMembershipApiActivityDomainPackage')
  })

  it('PUBLISHED edit validates persisted starts_at before payload publishability', () => {
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
    const domainTests = read('cloudfunctions/membership-admin-api/tests/domain.test.js')

    expect(workflows).toMatch(
      /existing\.status === 'PUBLISHED'[\s\S]*?existing\.starts_at[\s\S]*?EVENT_ALREADY_STARTED[\s\S]*?assertEventPublishable/,
    )
    expect(domainTests).toContain('rejects editing a PUBLISHED event whose persisted starts_at is already past')
  })

  it('cancel version conflict locks submit and requires explicit refresh + reopen', () => {
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(pageTs).toContain('cancelConflict: true')
    expect(pageTs).toContain('refreshAfterCancelConflict')
    expect(pageTs).not.toMatch(/cancelEventVersion:\s*latest\.version/)
    expect(pageTs).toMatch(/EVENT_VERSION_CONFLICT[\s\S]*?cancelDialogVisible: false[\s\S]*?cancelConflict: true/)
    expect(pageWxml).toContain('refreshAfterCancelConflict')
    expect(pageWxml).toContain('cancelDialogVisible && !cancelConflict')
  })

  it('default roster DTO exposes phoneBound only, never phoneMasked', () => {
    const types = read('src/modules/admin/types.ts')
    const dto = read('src/modules/admin/event-dto.ts')
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')
    const wxml = read('src/packages/admin/event-registrations/index.wxml')

    expect(types).toContain('phoneBound: boolean')
    expect(types).not.toContain('phoneMasked')
    expect(dto).toContain('phoneBound: requireBoolean(value.phoneBound, \'phoneBound\')')
    expect(dto).not.toContain('phoneMasked')
    expect(workflows).toContain('phoneBound: Boolean(row.phone_number)')
    expect(workflows).not.toMatch(/phoneMasked:\s*maskPhone/)
    expect(wxml).toContain('手机已绑定')
    expect(wxml).not.toContain('phoneMasked')
  })

  it('roster sort prefers effective status and binds cursor signature to filter+sort', () => {
    const roster = read('cloudfunctions/membership-admin-api/domain/roster.js')
    const workflows = read('cloudfunctions/membership-admin-api/lib/workflows.js')

    expect(roster).toContain('statusRank,registeredAtDesc,idDesc')
    expect(roster).toContain('PENDING_REVIEW: 0')
    expect(roster).toContain('WAITLISTED: 1')
    expect(roster).toContain('REGISTERED: 2')
    expect(roster).toContain('CANCELLATION_PENDING: 3')
    expect(roster).toContain('ATTENDED: 4')
    expect(roster).toContain('REJECTED: 5')
    expect(roster).toContain('CANCELLED: 6')
    expect(workflows).toContain('ROSTER_ORDER_SQL')
    expect(workflows).toMatch(/CASE r\.status[\s\S]*REGISTERED[\s\S]*CANCELLATION_PENDING[\s\S]*ATTENDED[\s\S]*CANCELLED/)
  })

  it('real pages set confirm latch before showModal and release loadMore loading when superseded', () => {
    const events = read('src/packages/admin/events/index.ts')
    const roster = read('src/packages/admin/event-registrations/index.ts')
    const ticket = read('src/packages/member/ticket/index.ts')
    const profiles = read('src/packages/admin/profiles/index.ts')
    const orders = read('src/packages/admin/orders/index.ts')

    for (const source of [events, ticket, profiles, orders]) {
      // processingId/busy latch appears before showModal in each confirm path.
      expect(source).toMatch(/setData\(\{ (?:processingId|busy):[\s\S]{0,80}showModal/)
    }
    expect(roster).toMatch(/this\.confirmationBusy = true[\s\S]*?showModal/)
    expect(roster).toContain('loadingMoreSeq')
    expect(roster).toMatch(/this\.loadMoreSeq \+= 1[\s\S]*?loadingMore: false/)
    expect(roster).toMatch(/if \(this\.loadingMoreSeq === seq\)/)
  })
})
