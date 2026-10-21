import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createParticipationAccessPolicy } = require('../cloudfunctions/mip-events-api/domain/participation-access.js')

const agreements = [{ key: 'SERVICE_AGREEMENT', version: 'current' }]
const caller = { appId: 'test-app', userId: 'operator' }
const facts = {
  id: 'operator',
  status: 'ACTIVE',
  primary_branch_id: 'branch',
  nickname: '运营',
  phone_verified_at: '2026-10-21T00:00:00Z',
  agreement_0_accepted: 1,
  // Consumer onboarding is incomplete; this must not replace separate operator authorization.
  profile_complete: 0,
}
function database(row: Record<string, unknown> = facts, accepted = true) {
  return {
    one: async () => row,
    query: async () => accepted ? [{ agreement_key: 'SERVICE_AGREEMENT', agreement_version: 'current' }] : [],
  }
}

describe('operator readiness stays separate from consumer profile completion', () => {
  for (const api of ['mip-tasks-api', 'mip-banners-api', 'mip-game-api']) {
    const { assertFullAccessReady } = require(`../cloudfunctions/${api}/lib/full-access.js`)
    it(`${api}: preserves existing operator requirements without consumer onboarding fields`, async () => {
      await expect(assertFullAccessReady(database(), caller, agreements)).resolves.toBeUndefined()
      for (const patch of [{ status: 'BLOCKED' }, { primary_branch_id: null }, { nickname: '' }, { phone_verified_at: null }]) {
        await expect(assertFullAccessReady(database({ ...facts, ...patch }), caller, agreements)).rejects.toThrow()
      }
      await expect(assertFullAccessReady(database(facts, false), caller, agreements)).rejects.toThrow('AGREEMENT_REQUIRED')
    })
  }

  it('still rejects an incomplete consumer profile for event participation', async () => {
    await expect(createParticipationAccessPolicy({ agreements }).requireAccess(database(), caller.appId, caller.userId))
      .rejects
      .toMatchObject({ code: 'PROFILE_REQUIRED' })
  })
})
