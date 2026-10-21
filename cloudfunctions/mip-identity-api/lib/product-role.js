'use strict'

// Vendored into each independent cloud-function bundle. Parity is checked by tests.
// Product labels never replace membership permissions or admin role bindings.
function activePlayerSql(user = 'u') {
  return `EXISTS (SELECT 1 FROM mip_membership_entitlements role_membership
    WHERE role_membership.app_id = ${user}.app_id AND role_membership.user_id = ${user}.id
      AND role_membership.status = 'ACTIVE'
      AND role_membership.starts_at <= UTC_TIMESTAMP(3) AND role_membership.ends_at > UTC_TIMESTAMP(3))`
}

function attendedEventSql(user = 'u') {
  return `EXISTS (SELECT 1 FROM mip_event_registrations role_registration
    INNER JOIN mip_event_checkins role_checkin
      ON role_checkin.app_id = role_registration.app_id
        AND role_checkin.registration_id = role_registration.id
        AND role_checkin.event_id = role_registration.event_id
        AND role_checkin.user_id = role_registration.user_id AND role_checkin.status = 'ACTIVE'
    WHERE role_registration.app_id = ${user}.app_id AND role_registration.user_id = ${user}.id
      AND role_registration.status = 'ATTENDED')`
}

function productRole({ authenticated = true, isPlayer = false, hasAttended = false } = {}) {
  if (!authenticated) return 'ANONYMOUS'
  if (isPlayer) return 'PLAYER'
  return hasAttended ? 'GUEST' : 'NORMAL'
}

module.exports = { activePlayerSql, attendedEventSql, productRole }
