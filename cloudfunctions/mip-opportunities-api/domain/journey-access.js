'use strict'

// Role facts are resolved from the current app, never from a client role label.
async function canBrowseTalents(database, caller) {
  if (!caller.userId) return false
  const row = await database.one(
    `SELECT id FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
       AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    [caller.appId, caller.userId],
  )
  return Boolean(row)
}

async function canBrowsePlatformOpportunities(database, caller) {
  if (!caller.userId) return false
  if (await canBrowseTalents(database, caller)) return true
  const row = await database.one(
    `SELECT checkin.id FROM mip_event_checkins checkin
     INNER JOIN mip_event_registrations registration
       ON registration.app_id = checkin.app_id AND registration.id = checkin.registration_id
         AND registration.user_id = checkin.user_id AND registration.status = 'ATTENDED'
     WHERE checkin.app_id = ? AND checkin.user_id = ? AND checkin.status = 'ACTIVE'
     LIMIT 1`,
    [caller.appId, caller.userId],
  )
  return Boolean(row)
}

function opportunityVisibility(caller, opportunityAlias = 'o', profileAlias = 'p') {
  return {
    sql: `(${opportunityAlias}.owner_user_id = ?
      OR (${opportunityAlias}.players_only = 0
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${profileAlias}.visibility_json, '$.opportunitiesForNonPlayers')), 'true') <> 'false')
      OR EXISTS (SELECT 1 FROM mip_membership_entitlements privacy_membership
        WHERE privacy_membership.app_id = ${opportunityAlias}.app_id AND privacy_membership.user_id = ?
          AND privacy_membership.status = 'ACTIVE'
          AND privacy_membership.starts_at <= UTC_TIMESTAMP(3) AND privacy_membership.ends_at > UTC_TIMESTAMP(3)))`,
    params: [caller.userId || null, caller.userId || null],
  }
}

module.exports = { canBrowsePlatformOpportunities, canBrowseTalents, opportunityVisibility }
