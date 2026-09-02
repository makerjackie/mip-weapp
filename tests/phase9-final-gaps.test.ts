import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('phase9 final gap contracts', () => {
  it('replays MIP registrations without mutating ticket or order facts', () => {
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const registrationFlow = service.slice(
      service.indexOf('async function createRegistration'),
      service.indexOf('async function listMyRegistrations'),
    )
    const replayBranch = registrationFlow.slice(
      registrationFlow.indexOf('if (claim.replay)'),
      registrationFlow.indexOf('const event = await tx.one'),
    )
    const existingIndex = registrationFlow.indexOf('if (existing && activeRegistrationStatuses.has(existing.status))')
    const accessIndex = registrationFlow.indexOf('await requireCurrentParticipationAccess')
    const existingBranch = registrationFlow.slice(existingIndex, accessIndex)

    expect(registrationFlow).toContain('operation: \'event.register\'')
    expect(replayBranch).toContain('return claim.replay')
    expect(replayBranch).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+/)
    expect(existingIndex).toBeGreaterThan(0)
    expect(accessIndex).toBeGreaterThan(existingIndex)
    expect(existingBranch).toContain('registrationOutcome(existing, { paymentAvailable })')
    expect(existingBranch).toContain('completeIdempotency')
    expect(existingBranch).not.toContain('ticketHash')
    expect(registrationFlow).not.toContain('member_registrations')
    expect(registrationFlow).not.toContain('ticket_code')
  })

  it('verifies and deploys only direct MIP Cloud Function sources', () => {
    const functionNames = read('scripts/lib/mip-function-names.mjs')
    const manifest = read('scripts/lib/mip-function-manifest.mjs')
    const verifySource = read('scripts/verify-source.mjs')
    const verifyServer = read('scripts/verify-server.mjs')
    const deploy = read('scripts/deploy-functions.mjs')

    const directSources = [
      'mip-identity-api',
      'mip-media-api',
      'mip-events-api',
      'mip-opportunities-api',
      'mip-community-api',
      'mip-commerce-api',
      'mip-admin-api',
      'mip-growth-api',
      'mip-ai-api',
      'mip-notifications-api',
      'mip-payment-ledger',
      'mip-notification-worker',
      'mip-outbox-worker',
      'mip-cloudpay',
      'mip-cloudpay-callback',
      'mip-refund-worker',
    ]
    for (const source of directSources) {
      expect(functionNames).toContain(`'${source}'`)
      expect(fs.existsSync(path.join(root, 'cloudfunctions', source, 'index.js'))).toBe(true)
    }
    expect(manifest).toContain('MIP_FUNCTION_SOURCES')
    expect(deploy).toContain('createMipCoreFunctionManifest')
    expect(deploy).toMatch(/admin:\s*\{[\s\S]*?MIP_PHONE_ENCRYPTION_KEY: options\.secrets\.phoneEncryption/)
    expect(verifySource).toContain('createMipCoreFunctionManifest')
    expect(verifyServer).toContain('MIP_FUNCTION_SOURCES')
    expect(verifyServer).toContain('sourceRoots')
    expect(`${verifySource}\n${verifyServer}\n${deploy}`).not.toContain('assertMembershipApiActivityDomainPackage')
  })

  it('publishes only from the locked persisted event status and starts_at', () => {
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const statusFlow = repository.slice(
      repository.indexOf('async function changeEventStatus'),
      repository.indexOf('async function cancelEventRegistrations'),
    )

    expect(statusFlow).toMatch(/SELECT id, branch_id, status, content_safety_status, starts_at, version[\s\S]*FOR UPDATE/)
    expect(statusFlow).toContain('input.status === \'PUBLISHED\' && event.content_safety_status !== \'PASSED\'')
    expect(statusFlow).toContain('input.status === \'PUBLISHED\' && new Date(event.starts_at) <= changedAt')
    expect(statusFlow.indexOf('new Date(event.starts_at)')).toBeLessThan(statusFlow.indexOf('UPDATE mip_events SET status'))
    expect(statusFlow).not.toContain('input.startsAt')
  })

  it('default MIP roster exposes only phoneBound until an audited phone request', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const rosterType = types.slice(
      types.indexOf('export interface AdminRosterItem'),
      types.indexOf('export interface AdminRoleItem'),
    )
    const rosterService = service.slice(
      service.indexOf('async function listRoster'),
      service.indexOf('async function checkIn'),
    )

    expect(rosterType).toContain('phoneBound: boolean')
    expect(rosterType).toContain('phoneNumber: string | null')
    expect(rosterType).not.toContain('phoneMasked')
    expect(repository).toContain('phoneBound: Boolean(row.phone_verified_at)')
    expect(rosterService).toContain('input.includePhone === true')
    expect(rosterService).toContain('CAPABILITIES.USERS_PHONE_READ')
    expect(rosterService).toContain('admin.events.roster.phone.view')
    expect(rosterService).toContain('const { phoneCiphertext, userId, ...safe } = item')
    expect(rosterService).not.toContain('phoneMasked')
  })

  it('keeps roster reads app/event scoped with deterministic ordering', () => {
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const roster = repository.slice(
      repository.indexOf('async function listRoster'),
      repository.indexOf('async function checkIn'),
    )

    expect(roster).toContain('const clauses = [\'r.app_id = ?\', \'r.event_id = ?\']')
    expect(roster).toContain('clauses.push(\'r.status = ?\')')
    expect(roster).toContain('clauses.push(\'p.nickname LIKE ? ESCAPE')
    expect(roster).toContain('ORDER BY r.created_at DESC, r.id DESC LIMIT ?')
    expect(roster).not.toMatch(/ORDER BY\s+\$\{/)
  })

  it('onsite roster latches confirmations and drops superseded responses', () => {
    const roster = read('src/packages/admin/event-registrations/index.ts')
    const eventDetail = read('src/packages/member/mip-events/detail/index.ts')

    expect(eventDetail).toMatch(/busy: true[\s\S]*?showModal/)
    expect(roster).toMatch(/this\.confirmationBusy = true[\s\S]*?showModal/)
    expect(roster).toContain('requestSeq: 0')
    expect(roster).toMatch(/if \(seq !== this\.requestSeq\)/)
  })
})
