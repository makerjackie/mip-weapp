'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { canBrowsePlatformOpportunities, canBrowseTalents, opportunityVisibility } = require('../domain/journey-access')
const caller = { appId: 'app-a', userId: 'user-a' }

for (const [role, member, checkedIn, opportunities, talents] of [
  ['ordinary', false, false, false, false],
  ['guest', false, true, true, false],
  ['player', true, false, true, true],
]) {
  test(`${role} catalogue access comes from the database`, async () => {
    const database = {
      async one(sql, params) {
        assert.deepEqual(params, [caller.appId, caller.userId])
        if (sql.includes('mip_membership_entitlements')) {
          assert.match(sql, /starts_at <= UTC_TIMESTAMP\(3\) AND ends_at > UTC_TIMESTAMP\(3\)/)
          return member ? { id: 'membership' } : null
        }
        assert.match(sql, /registration.status = 'ATTENDED'/)
        assert.match(sql, /checkin.status = 'ACTIVE'/)
        return checkedIn ? { id: 'checkin' } : null
      },
    }
    assert.equal(await canBrowsePlatformOpportunities(database, caller), opportunities)
    assert.equal(await canBrowseTalents(database, caller), talents)
  })
}

test('unauthenticated callers receive no privileged data even with a forged role label', async () => {
  const db = { async one() { throw new Error('must not query') } }
  const visitor = { appId: caller.appId, userId: null, userKind: 'PLAYER' }
  assert.equal(await canBrowseTalents(db, visitor), false)
  assert.equal(await canBrowsePlatformOpportunities(db, visitor), false)
})

test('opportunity privacy is parameterized for owner or current app membership and defaults to legacy visibility', () => {
  const result = opportunityVisibility(caller)
  assert.deepEqual(result.params, ['user-a', 'user-a'])
  assert.match(result.sql, /o.owner_user_id = \?/)
  assert.match(result.sql, /privacy_membership.app_id = o.app_id/)
  assert.match(result.sql, /opportunitiesForNonPlayers/)
  assert.match(result.sql, /privacy_membership.ends_at > UTC_TIMESTAMP\(3\)/)
})
