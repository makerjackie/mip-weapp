'use strict'

async function assertPlayerReady(database, caller) {
  const entitlement = await database.one(
    `SELECT id FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
       AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
     ORDER BY ends_at DESC, id DESC LIMIT 1`,
    [caller.appId, caller.userId],
  )
  if (!entitlement) throw new Error('MEMBERSHIP_REQUIRED')
}

module.exports = { assertPlayerReady }
