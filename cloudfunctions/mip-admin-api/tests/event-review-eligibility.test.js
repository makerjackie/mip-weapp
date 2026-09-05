'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

const currentTime = new Date('2026-09-05T10:00:00Z')
function setup({ user = {}, member = true, event = {} } = {}) {
  const writes = []
  const reads = []
  const database = {
    async one(sql, params) {
      reads.push({ sql, params })
      if (sql.includes('FROM mip_events')) return {
        id: 'event-a', access_type: 'MEMBER_INCLUDED', registration_policy: 'APPROVAL',
        status: 'PUBLISHED', ends_at: '2026-09-06T10:00:00Z', capacity: 20, waitlist_enabled: 1, ...event,
      }
      if (sql.includes('FROM mip_users u')) return {
        id: 'user-a', status: 'ACTIVE', primary_branch_id: 'branch-a', nickname: '参与者',
        phone_verified_at: currentTime, agreement_0_accepted: 1, agreement_1_accepted: 1, ...user,
      }
      if (sql.includes('FROM mip_membership_entitlements')) return member ? { id: 'entitlement-a' } : null
      if (sql.includes('COUNT(*)')) return { total: 0 }
      if (sql.includes('FROM mip_event_registrations')) return {
        id: 'registration-a', user_id: 'user-a', status: 'PENDING_REVIEW', version: 3,
      }
      return null
    },
    async query(sql, params) { writes.push({ sql, params }); return { affectedRows: 1 } },
    async transaction(work) { return work(this) },
  }
  const repository = createAdminRepository(database, withTestAuthorization({ now: () => currentTime }))
  const review = (decision = 'APPROVE') => repository.reviewRegistration({
    appId: 'wx-app', actorUserId: 'admin-a', eventId: 'event-a', registrationId: 'registration-a',
    expectedVersion: 3, decision, audit: () => ({ appId: 'wx-app', actorUserId: 'admin-a', metadata: {} }),
  })
  return { writes, reads, review }
}

describe('registration approval current eligibility', () => {
  for (const [name, options] of [
    ['disabled account', { user: { status: 'DISABLED' } }],
    ['outdated agreement', { user: { agreement_1_accepted: 0 } }],
    ['unbound phone', { user: { phone_verified_at: null } }],
    ['missing nickname', { user: { nickname: ' ' } }],
    ['missing branch', { user: { primary_branch_id: null } }],
    ['expired membership', { member: false }],
  ]) {
    it(`rejects ${name} before registration, audit or outbox writes`, async () => {
      const state = setup(options)
      await assert.rejects(state.review(), /REGISTRATION_INELIGIBLE/)
      assert.equal(state.writes.length, 0)
    })
  }
  it('locks current AppID-scoped user and entitlement before approval', async () => {
    const state = setup()
    assert.equal((await state.review()).status, 'REGISTERED')
    const user = state.reads.find(read => read.sql.includes('FROM mip_users u'))
    assert.match(user.sql, /FOR UPDATE/)
    assert.deepEqual(user.params.slice(-2), ['wx-app', 'user-a'])
    const entitlement = state.reads.find(read => read.sql.includes('FROM mip_membership_entitlements'))
    assert.match(entitlement.sql, /starts_at <= \? AND ends_at > \?/)
    assert.match(entitlement.sql, /FOR UPDATE/)
    assert.deepEqual(entitlement.params, ['wx-app', 'user-a', currentTime, currentTime])
  })
  it('allows free-event approval without a membership', async () => {
    const state = setup({ member: false, event: { access_type: 'FREE' } })
    assert.equal((await state.review()).status, 'REGISTERED')
  })
  it('does not approve an event that has already ended while still published', async () => {
    const state = setup({ event: { ends_at: currentTime } })
    await assert.rejects(state.review(), /EVENT_ENDED/)
    assert.equal(state.writes.length, 0)
  })
  it('allows rejection even when the user is no longer eligible and event has ended', async () => {
    const state = setup({ member: false, user: { status: 'DISABLED' }, event: { ends_at: currentTime } })
    assert.equal((await state.review('REJECT')).status, 'REJECTED')
    assert.equal(state.reads.some(read => read.sql.includes('FROM mip_users u')), false)
  })
})
