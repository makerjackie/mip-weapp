import { sqlJson, sqlLiteral } from './example-cloudbase.mjs'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/i
const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const OWNER_INTERACTION_EVENT_ID = '60000000-0000-4000-8000-000000000003'
export const OWNER_INTERACTION_REGISTRATION_ID = '61000000-0000-4000-8000-000000000009'
export const OWNER_INTERACTION_REGISTERED_AT = '2026-08-10 11:00:00.000'
export const OWNER_INTERACTION_EVENT_TITLE = 'MIP 城市互动交流会'

export function resolveOwnerInteractionFixtureCommand({ args = [], env = {} } = {}) {
  const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
  const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
  const stage = String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
  const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
  const paymentMode = String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
  const stagingConfirmationCount = args.filter(value => value === '--confirm-staging-demo').length
  const allowedAppIds = String(env.MIP_ALLOWED_APP_IDS || appId)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (!envId
    || !ENV_ID_PATTERN.test(envId)
    || !APP_ID_PATTERN.test(appId)
    || exactArgument(args, '--confirm-env=') !== envId
    || exactArgument(args, '--confirm-app-id=') !== appId
    || args.filter(value => value === '--confirm-owner-event-interaction').length !== 1) {
    throw new Error('Owner event interaction fixture requires exact environment, AppID, and confirmation flag')
  }
  if (!['development', 'test', 'staging'].includes(stage)
    || catalogStage !== 'TEST'
    || !['disabled', 'test'].includes(paymentMode)
    || (stage === 'staging' && stagingConfirmationCount !== 1)
    || (stage !== 'staging' && stagingConfirmationCount !== 0)) {
    throw new Error('Owner event interaction fixture is restricted to development/test; staging requires --confirm-staging-demo, TEST catalog, and non-live payment')
  }
  if (!allowedAppIds.includes(appId)
    || allowedAppIds.some(value => !APP_ID_PATTERN.test(value))) {
    throw new Error('MIP_ALLOWED_APP_IDS must contain valid AppIDs and include MINI_PROGRAM_APP_ID')
  }
  return Object.freeze({
    envId,
    appId,
    stage,
    catalogStage,
    paymentMode,
    stagingConfirmed: stage === 'staging',
    eventId: OWNER_INTERACTION_EVENT_ID,
    registrationId: OWNER_INTERACTION_REGISTRATION_ID,
  })
}

export function buildOwnerInteractionPreflightQuery({ appId, eventId, registrationId, ownerUserId }) {
  assertFixtureInput({ appId, eventId, registrationId, ownerUserId })
  return `SELECT
    (SELECT COUNT(*) FROM mip_events
      WHERE id = ${sqlLiteral(eventId)} AND app_id <> ${sqlLiteral(appId)}) AS eventCrossApp,
    (SELECT COUNT(*) FROM mip_events
      WHERE id = ${sqlLiteral(eventId)} AND app_id = ${sqlLiteral(appId)}) AS eventSameApp,
    (SELECT COUNT(*) FROM mip_events event
      WHERE event.id = ${sqlLiteral(eventId)}
        AND event.app_id = ${sqlLiteral(appId)}
        AND event.status = 'ENDED'
        AND event.access_type = 'FREE'
        AND event.ends_at < UTC_TIMESTAMP(3)
        AND BINARY event.title = BINARY ${sqlLiteral(OWNER_INTERACTION_EVENT_TITLE)}
        AND EXISTS (
          SELECT 1 FROM mip_app_settings demo_manifest
          WHERE demo_manifest.app_id = event.app_id
            AND demo_manifest.setting_key = 'demo_seed_manifest'
            AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
            AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.state')) = 'READY'
            AND JSON_SEARCH(
              JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.mip_events'),
              'one', event.id
            ) IS NOT NULL
        )) AS eventReadyRows,
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE id = ${sqlLiteral(registrationId)}) AS fixedRegistrationRows,
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE app_id = ${sqlLiteral(appId)} AND event_id = ${sqlLiteral(eventId)}
        AND user_id = ${sqlLiteral(ownerUserId)}) AS ownerEventRows`
}

export function buildOwnerInteractionInsertQuery({ appId, eventId, registrationId, ownerUserId }) {
  assertFixtureInput({ appId, eventId, registrationId, ownerUserId })
  return `INSERT INTO mip_event_registrations (
    id, app_id, event_id, user_id, order_id, status, answers_json, form_version,
    share_profile, ticket_hash, waitlisted_at, registered_at, cancelled_at,
    cancellation_reason, cancelled_by_type, version
  ) VALUES (
    ${sqlLiteral(registrationId)}, ${sqlLiteral(appId)}, ${sqlLiteral(eventId)},
    ${sqlLiteral(ownerUserId)}, NULL, 'ATTENDED', ${sqlJson({})}, 1,
    1, NULL, NULL, ${sqlLiteral(OWNER_INTERACTION_REGISTERED_AT)}, NULL,
    NULL, NULL, 2
  )`
}

export function buildOwnerInteractionVerificationQuery({ appId, eventId, registrationId, ownerUserId }) {
  assertFixtureInput({ appId, eventId, registrationId, ownerUserId })
  return `SELECT COUNT(*) AS ready
    FROM mip_event_registrations
    WHERE app_id = ${sqlLiteral(appId)}
      AND id = ${sqlLiteral(registrationId)}
      AND event_id = ${sqlLiteral(eventId)}
      AND user_id = ${sqlLiteral(ownerUserId)}
      AND status = 'ATTENDED'
      AND version >= 2`
}

export function ownerInteractionFixtureSummary(value) {
  if (!value || value.ready !== 1) {
    throw new Error('Owner event interaction fixture verification failed')
  }
  return {
    ready: true,
    registrationStatus: 'ATTENDED',
    interactionPage: 'packages/member/mip-events/interaction/index',
  }
}

function assertFixtureInput({ appId, eventId, registrationId, ownerUserId }) {
  if (!APP_ID_PATTERN.test(String(appId || ''))
    || !UUID_PATTERN.test(String(eventId || ''))
    || !UUID_PATTERN.test(String(registrationId || ''))
    || !UUID_PATTERN.test(String(ownerUserId || ''))) {
    throw new Error('Owner event interaction fixture SQL input is invalid')
  }
}

function exactArgument(args, prefix) {
  const matches = args.filter(value => value.startsWith(prefix))
  return matches.length === 1 ? matches[0].slice(prefix.length) : ''
}
