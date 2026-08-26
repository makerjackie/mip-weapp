import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('MIP check-in growth compensation contract', () => {
  it('adds immutable transitions and permits an exact signed experience correction', () => {
    const migration = read('database/mysql/mip/015_checkin_growth_compensation.sql')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_event_checkin_transitions')
    expect(migration).toContain('transition_type IN (\'CHECKED_IN\', \'REVOKED\')')
    expect(migration).toContain('UNIQUE KEY mip_event_checkin_transitions_reversal_uk')
    expect(migration).toContain('MODIFY experience_balance BIGINT NOT NULL DEFAULT 0')
    expect(migration).toContain('DROP CHECK mip_growth_entries_balance_ck')
    expect(migration).not.toMatch(/DELETE FROM|DROP COLUMN/)
  })

  it('keeps transition facts append-only in the runtime grant map', () => {
    const grants = read('scripts/lib/mysql-privilege-assert.mjs')
    expect(grants).toContain('mip_event_checkin_transitions: Object.freeze([\'SELECT\', \'INSERT\'])')
    expect(grants).not.toMatch(/mip_event_checkin_transitions[^\n]+(?:UPDATE|DELETE)/)
  })

  it('routes scan, admin override and worker projection through the transition id', () => {
    const eventService = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const adminRepository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const projector = read('cloudfunctions/mip-outbox-worker/domain/projector.js')
    const growth = read('cloudfunctions/mip-growth-api/domain/checkin-compensation.js')
    for (const source of [eventService, adminRepository]) {
      expect(source).toContain('aggregateType: \'EVENT_CHECKIN_TRANSITION\'')
      expect(source).toContain('writeCheckInTransition')
    }
    expect(adminRepository).toContain('eventType: \'event.checkin_revoked\'')
    expect(projector).toContain('action: \'applyCheckInTransition\'')
    expect(growth).toContain('reversal_of_transition_id = ?')
    expect(growth).toContain('const delta = -Number(original.delta_value)')
  })
})
