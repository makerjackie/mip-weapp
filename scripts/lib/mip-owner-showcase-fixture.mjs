import { Buffer } from 'node:buffer'
import { sqlJson, sqlLiteral } from './example-cloudbase.mjs'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/i
const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const OWNER_SHOWCASE_EVENTS = Object.freeze([
  Object.freeze({
    eventId: '60000000-0000-4000-8000-000000000002',
    registrationId: '62000000-0000-4000-8000-000000000001',
  }),
  Object.freeze({
    eventId: '60000000-0000-4000-8000-000000000004',
    registrationId: '62000000-0000-4000-8000-000000000002',
  }),
])

export const OWNER_SHOWCASE_PAID_EVENT = Object.freeze({
  eventId: '60000000-0000-4000-8000-000000000005',
  registrationId: '62000000-0000-4000-8000-000000000003',
  orderId: '64000000-0000-4000-8000-000000000001',
  amountCents: 39900,
})

export const OWNER_SHOWCASE_BADGES = Object.freeze([
  Object.freeze({
    badgeId: '42000000-0000-4000-8000-000000000001',
    awardId: '63000000-0000-4000-8000-000000000001',
    slotNo: 1,
    reason: 'TEST 演示夹具：资料完善',
  }),
  Object.freeze({
    badgeId: '42000000-0000-4000-8000-000000000002',
    awardId: '63000000-0000-4000-8000-000000000002',
    slotNo: 2,
    reason: 'TEST 演示夹具：活动参与',
  }),
  Object.freeze({
    badgeId: '42000000-0000-4000-8000-000000000003',
    awardId: '63000000-0000-4000-8000-000000000003',
    slotNo: 3,
    reason: 'TEST 演示夹具：社区贡献',
  }),
])

export const OWNER_SHOWCASE_TASK_ASSIGNMENTS = Object.freeze([
  Object.freeze({
    taskId: '68000000-0000-4000-8000-000000000002',
    assignmentId: '68300000-0000-4000-8000-000000000001',
  }),
  Object.freeze({
    taskId: '68000000-0000-4000-8000-000000000003',
    assignmentId: '68300000-0000-4000-8000-000000000002',
  }),
])

export const OWNER_SHOWCASE_PROFILE = Object.freeze({
  realName: 'Jackie Xiao',
  gender: 'MALE',
  careerIdentityKey: 'COMPANY_OWNER',
  companies: Object.freeze([{ name: '01MVP', role: '产品负责人' }]),
  organizations: Object.freeze([{ name: 'MIP 深圳分会', role: '玩家' }]),
  wechat: 'mip_demo_2030',
  email: 'demo@mip.example',
  address: '深圳市福田区香蜜湖街道',
})

const REGISTERED_AT = '2026-08-27 00:00:00.000'
const AWARDED_AT = '2026-08-27 00:00:00.000'
const ASSIGNED_AT = '2026-08-28 00:00:00.000'
const ALL_SHOWCASE_EVENTS = Object.freeze([...OWNER_SHOWCASE_EVENTS, OWNER_SHOWCASE_PAID_EVENT])

export function resolveOwnerShowcaseCommand({ args = [], env = {} } = {}) {
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
    || args.filter(value => value === '--confirm-owner-showcase').length !== 1) {
    throw new Error('Owner showcase fixture requires exact environment, AppID, and confirmation flag')
  }
  if (!['development', 'test', 'staging'].includes(stage)
    || catalogStage !== 'TEST'
    || !['disabled', 'test'].includes(paymentMode)
    || (stage === 'staging' && stagingConfirmationCount !== 1)
    || (stage !== 'staging' && stagingConfirmationCount !== 0)) {
    throw new Error('Owner showcase fixture is restricted to development/test; staging requires --confirm-staging-demo, TEST catalog, and non-live payment')
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
  })
}

export function buildOwnerShowcasePreflightQuery({ appId, ownerUserId }) {
  assertOwnerInput({ appId, ownerUserId })
  const eventIds = ALL_SHOWCASE_EVENTS.map(item => sqlLiteral(item.eventId)).join(', ')
  const registrationIds = ALL_SHOWCASE_EVENTS.map(item => sqlLiteral(item.registrationId)).join(', ')
  const freeRegistrationIds = OWNER_SHOWCASE_EVENTS.map(item => sqlLiteral(item.registrationId)).join(', ')
  const orderIds = ALL_SHOWCASE_EVENTS.filter(item => item.orderId).map(item => sqlLiteral(item.orderId)).join(', ') || sqlLiteral('')
  const badgeIds = OWNER_SHOWCASE_BADGES.map(item => sqlLiteral(item.badgeId)).join(', ')
  const awardIds = OWNER_SHOWCASE_BADGES.map(item => sqlLiteral(item.awardId)).join(', ')
  const slots = OWNER_SHOWCASE_BADGES.map(item => String(item.slotNo)).join(', ')
  const taskIds = OWNER_SHOWCASE_TASK_ASSIGNMENTS.map(item => sqlLiteral(item.taskId)).join(', ')
  const assignmentIds = OWNER_SHOWCASE_TASK_ASSIGNMENTS.map(item => sqlLiteral(item.assignmentId)).join(', ')
  return `SELECT
    (SELECT COUNT(*) FROM mip_events WHERE app_id = ${sqlLiteral(appId)} AND id IN (${eventIds})) AS eventSameApp,
    (SELECT COUNT(*) FROM mip_events WHERE id IN (${eventIds}) AND app_id <> ${sqlLiteral(appId)}) AS eventCrossApp,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE app_id = ${sqlLiteral(appId)} AND id IN (${registrationIds})) AS fixedRegistrationRows,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE app_id = ${sqlLiteral(appId)} AND id IN (${freeRegistrationIds})) AS fixedFreeRegistrationRows,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE app_id = ${sqlLiteral(appId)} AND id = '62000000-0000-4000-8000-000000000003' AND user_id = ${sqlLiteral(ownerUserId)} AND status = 'REGISTERED') AS paidRegisteredRows,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE id IN (${registrationIds}) AND app_id <> ${sqlLiteral(appId)}) AS registrationCrossApp,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)} AND event_id IN (${eventIds})) AS ownerEventRows,
    (SELECT COUNT(*) FROM mip_event_registrations WHERE app_id = ${sqlLiteral(appId)} AND id IN (${registrationIds}) AND user_id = ${sqlLiteral(ownerUserId)} AND status = 'REGISTERED') AS registeredRows,
    (SELECT COUNT(*) FROM mip_orders WHERE app_id = ${sqlLiteral(appId)} AND id IN (${orderIds})) AS fixedEventOrderRows,
    (SELECT COUNT(*) FROM mip_orders WHERE id IN (${orderIds}) AND app_id <> ${sqlLiteral(appId)}) AS eventOrderCrossApp,
    (SELECT COUNT(*) FROM mip_orders WHERE app_id = ${sqlLiteral(appId)} AND id IN (${orderIds}) AND user_id = ${sqlLiteral(ownerUserId)} AND order_type = 'EVENT' AND resource_id = '60000000-0000-4000-8000-000000000005' AND status = 'PAID' AND provider_transaction_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(product_snapshot_json, '$.catalogStage')) = 'TEST' AND JSON_UNQUOTE(JSON_EXTRACT(product_snapshot_json, '$.demo')) = 'true') AS paidEventOrderRows,
    (SELECT COUNT(*) FROM mip_badges WHERE app_id = ${sqlLiteral(appId)} AND id IN (${badgeIds}) AND status = 'ACTIVE') AS activeBadgeRows,
    (SELECT COUNT(*) FROM mip_badges WHERE id IN (${badgeIds}) AND app_id <> ${sqlLiteral(appId)}) AS badgeCrossApp,
    (SELECT COUNT(*) FROM mip_user_badges WHERE app_id = ${sqlLiteral(appId)} AND id IN (${awardIds})) AS fixedAwardRows,
    (SELECT COUNT(*) FROM mip_user_badges WHERE app_id = ${sqlLiteral(appId)} AND id IN (${awardIds}) AND user_id = ${sqlLiteral(ownerUserId)} AND status = 'ACTIVE') AS activeAwardRows,
    (SELECT COUNT(*) FROM mip_user_badges WHERE id IN (${awardIds}) AND app_id <> ${sqlLiteral(appId)}) AS awardCrossApp,
    (SELECT COUNT(*) FROM mip_user_badge_profiles WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}) AS badgeProfileRows,
    (SELECT COUNT(*) FROM mip_user_badge_equipment WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)} AND slot_no IN (${slots})) AS equipmentRows,
    (SELECT COUNT(*) FROM mip_user_badge_equipment WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)} AND badge_id IN (${badgeIds})) AS equipmentBadgeRows,
    (SELECT COUNT(*) FROM mip_task_cards WHERE app_id = ${sqlLiteral(appId)} AND id IN (${taskIds}) AND assignment_mode = 'SELECTED' AND status = 'PUBLISHED') AS activeTaskRows,
    (SELECT COUNT(*) FROM mip_task_cards WHERE id IN (${taskIds}) AND app_id <> ${sqlLiteral(appId)}) AS taskCrossApp,
    (SELECT COUNT(*) FROM mip_task_assignments WHERE app_id = ${sqlLiteral(appId)} AND id IN (${assignmentIds})) AS fixedTaskAssignmentRows,
    (SELECT COUNT(*) FROM mip_task_assignments WHERE id IN (${assignmentIds}) AND app_id <> ${sqlLiteral(appId)}) AS taskAssignmentCrossApp,
    (SELECT COUNT(*) FROM mip_task_assignments WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)} AND task_id IN (${taskIds})) AS ownerTaskAssignmentRows,
    (SELECT COUNT(*) FROM mip_task_assignments WHERE app_id = ${sqlLiteral(appId)} AND id IN (${assignmentIds}) AND user_id = ${sqlLiteral(ownerUserId)} AND status = 'ACTIVE') AS activeTaskAssignmentRows,
    (SELECT COUNT(*) FROM mip_profiles WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
      AND NULLIF(TRIM(real_name), '') IS NOT NULL AND gender IN ('MALE', 'FEMALE')
      AND NULLIF(TRIM(career_identity_key), '') IS NOT NULL
      AND JSON_LENGTH(companies_json) > 0 AND JSON_LENGTH(organizations_json) > 0) AS profileReadyRows,
    (SELECT COUNT(*) FROM mip_private_profiles WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
      AND wechat_ciphertext IS NOT NULL AND email_ciphertext IS NOT NULL AND address_ciphertext IS NOT NULL) AS privateContactReadyRows`
}

export function buildOwnerShowcaseStateQuery({ appId, ownerUserId }) {
  assertOwnerInput({ appId, ownerUserId })
  const eventIds = ALL_SHOWCASE_EVENTS.map(item => sqlLiteral(item.eventId)).join(', ')
  const badgeIds = OWNER_SHOWCASE_BADGES.map(item => sqlLiteral(item.badgeId)).join(', ')
  const taskIds = OWNER_SHOWCASE_TASK_ASSIGNMENTS.map(item => sqlLiteral(item.taskId)).join(', ')
  return `SELECT
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
        AND event_id IN (${eventIds}) AND status = 'REGISTERED') AS registeredEvents,
    (SELECT COUNT(*) FROM mip_orders
      WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
        AND id = '64000000-0000-4000-8000-000000000001' AND order_type = 'EVENT'
        AND status = 'PAID' AND provider_transaction_id IS NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(product_snapshot_json, '$.catalogStage')) = 'TEST'
        AND JSON_UNQUOTE(JSON_EXTRACT(product_snapshot_json, '$.demo')) = 'true') AS paidEventOrders,
    (SELECT COUNT(*) FROM mip_user_badges
      WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
        AND badge_id IN (${badgeIds}) AND status = 'ACTIVE') AS activeBadges,
    (SELECT COUNT(*) FROM mip_user_badge_equipment
      WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
        AND badge_id IN (${badgeIds})) AS equippedBadges,
    (SELECT COUNT(*) FROM mip_task_assignments
      WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
        AND task_id IN (${taskIds}) AND status = 'ACTIVE') AS assignedTasks,
    (SELECT COUNT(*) FROM mip_profiles WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
      AND NULLIF(TRIM(real_name), '') IS NOT NULL AND gender IN ('MALE', 'FEMALE')
      AND NULLIF(TRIM(career_identity_key), '') IS NOT NULL
      AND JSON_LENGTH(companies_json) > 0 AND JSON_LENGTH(organizations_json) > 0) AS profileReady,
    (SELECT COUNT(*) FROM mip_private_profiles WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}
      AND wechat_ciphertext IS NOT NULL AND email_ciphertext IS NOT NULL AND address_ciphertext IS NOT NULL) AS privateContactsReady`
}

export function buildOwnerShowcaseProfileUpdate({ appId, ownerUserId }) {
  assertOwnerInput({ appId, ownerUserId })
  return `UPDATE mip_profiles SET
    real_name = COALESCE(NULLIF(TRIM(real_name), ''), ${sqlLiteral(OWNER_SHOWCASE_PROFILE.realName)}),
    gender = CASE WHEN gender IS NULL OR gender = 'UNKNOWN' THEN ${sqlLiteral(OWNER_SHOWCASE_PROFILE.gender)} ELSE gender END,
    career_identity_key = COALESCE(NULLIF(TRIM(career_identity_key), ''), ${sqlLiteral(OWNER_SHOWCASE_PROFILE.careerIdentityKey)}),
    companies_json = CASE WHEN JSON_LENGTH(companies_json) = 0 THEN ${sqlJson(OWNER_SHOWCASE_PROFILE.companies)} ELSE companies_json END,
    organizations_json = CASE WHEN JSON_LENGTH(organizations_json) = 0 THEN ${sqlJson(OWNER_SHOWCASE_PROFILE.organizations)} ELSE organizations_json END,
    visibility_json = JSON_SET(COALESCE(visibility_json, JSON_OBJECT()),
      '$.realName', true, '$.gender', true, '$.careerIdentity', true,
      '$.companies', true, '$.organizations', true,
      '$.cardContacts', JSON_OBJECT('phone', true, 'wechat', true, 'email', true, 'address', true)),
    version = version + 1
    WHERE app_id = ${sqlLiteral(appId)} AND user_id = ${sqlLiteral(ownerUserId)}`
}

export function buildOwnerShowcasePrivateContactUpsert({ appId, ownerUserId, ciphertext }) {
  assertOwnerInput({ appId, ownerUserId })
  const wechat = binaryLiteral(ciphertext?.wechat)
  const email = binaryLiteral(ciphertext?.email)
  const address = binaryLiteral(ciphertext?.address)
  return `INSERT INTO mip_private_profiles (app_id, user_id, wechat_ciphertext, email_ciphertext, address_ciphertext)
    VALUES (${sqlLiteral(appId)}, ${sqlLiteral(ownerUserId)}, ${wechat}, ${email}, ${address})
    ON DUPLICATE KEY UPDATE
      wechat_ciphertext = COALESCE(mip_private_profiles.wechat_ciphertext, VALUES(wechat_ciphertext)),
      email_ciphertext = COALESCE(mip_private_profiles.email_ciphertext, VALUES(email_ciphertext)),
      address_ciphertext = COALESCE(mip_private_profiles.address_ciphertext, VALUES(address_ciphertext))`
}

export function buildOwnerShowcaseRegistrationInsert({ appId, ownerUserId, eventId, registrationId }) {
  assertOwnerInput({ appId, ownerUserId })
  assertUuid(eventId, 'eventId')
  assertUuid(registrationId, 'registrationId')
  if (!ALL_SHOWCASE_EVENTS.some(item => item.eventId === eventId && item.registrationId === registrationId)) {
    throw new Error('Owner showcase event is not in the fixed TEST fixture allowlist')
  }
  return `INSERT INTO mip_event_registrations (
    id, app_id, event_id, user_id, order_id, status, answers_json, form_version,
    share_profile, ticket_hash, waitlisted_at, registered_at, cancelled_at,
    cancellation_reason, cancelled_by_type, version
  ) VALUES (
    ${sqlLiteral(registrationId)}, ${sqlLiteral(appId)}, ${sqlLiteral(eventId)},
    ${sqlLiteral(ownerUserId)}, ${sqlLiteral(ALL_SHOWCASE_EVENTS.find(item => item.eventId === eventId)?.orderId || null)}, 'REGISTERED', ${sqlJson({})}, 1,
    1, NULL, NULL, ${sqlLiteral(REGISTERED_AT)}, NULL,
    NULL, NULL, 1
  )`
}

export function buildOwnerShowcaseEventOrderInsert({ appId, ownerUserId }) {
  assertOwnerInput({ appId, ownerUserId })
  const fixture = OWNER_SHOWCASE_PAID_EVENT
  if (!fixture) {
    throw new Error('Owner showcase event order is not configured')
  }
  return `INSERT INTO mip_orders (
    id, app_id, user_id, order_type, resource_id, membership_plan_id,
    merchant_order_no, provider_transaction_id, idempotency_key, amount_cents,
    currency, status, product_snapshot_json, paid_at, closed_at, version
  ) VALUES (
    ${sqlLiteral(fixture.orderId)}, ${sqlLiteral(appId)}, ${sqlLiteral(ownerUserId)},
    'EVENT', ${sqlLiteral(fixture.eventId)}, NULL,
    'MIP-TEST-OWNER-EVENT-1', NULL, 'owner-showcase-event-1', ${Number(fixture.amountCents)},
    'CNY', 'PAID', ${sqlJson({
      eventId: fixture.eventId,
      eventTitle: 'MIP 早会（2030 年 12 月·主题场）',
      priceCents: fixture.amountCents,
      currency: 'CNY',
      catalogStage: 'TEST',
      demo: true,
      fixture: 'owner-showcase',
    })}, '2026-08-27 00:00:00.000', NULL, 1
  )`
}

export function buildOwnerShowcaseBadgeInsert({ appId, ownerUserId, badge }) {
  assertOwnerInput({ appId, ownerUserId })
  if (!badge || !OWNER_SHOWCASE_BADGES.some(item => item.badgeId === badge.badgeId && item.awardId === badge.awardId && item.slotNo === badge.slotNo)) {
    throw new Error('Owner showcase badge is not in the fixed TEST fixture allowlist')
  }
  return `INSERT INTO mip_user_badges (
    id, app_id, user_id, badge_id, status, award_reason, awarded_by_user_id, awarded_at,
    revoked_by_user_id, revoke_reason, revoked_at, version
  ) VALUES (
    ${sqlLiteral(badge.awardId)}, ${sqlLiteral(appId)}, ${sqlLiteral(ownerUserId)}, ${sqlLiteral(badge.badgeId)},
    'ACTIVE', ${sqlLiteral(badge.reason)}, ${sqlLiteral(ownerUserId)}, ${sqlLiteral(AWARDED_AT)},
    NULL, NULL, NULL, 1
  )`
}

export function buildOwnerShowcaseBadgeProfileInsert({ appId, ownerUserId }) {
  assertOwnerInput({ appId, ownerUserId })
  return `INSERT INTO mip_user_badge_profiles (app_id, user_id, version, updated_at)
    VALUES (${sqlLiteral(appId)}, ${sqlLiteral(ownerUserId)}, 1, ${sqlLiteral(AWARDED_AT)})`
}

export function buildOwnerShowcaseBadgeEquipmentInsert({ appId, ownerUserId, badge }) {
  assertOwnerInput({ appId, ownerUserId })
  if (!badge || !OWNER_SHOWCASE_BADGES.some(item => item.badgeId === badge.badgeId && item.slotNo === badge.slotNo)) {
    throw new Error('Owner showcase badge equipment is not in the fixed TEST fixture allowlist')
  }
  return `INSERT INTO mip_user_badge_equipment (app_id, user_id, slot_no, badge_id, equipped_at)
    VALUES (${sqlLiteral(appId)}, ${sqlLiteral(ownerUserId)}, ${Number(badge.slotNo)},
      ${sqlLiteral(badge.badgeId)}, ${sqlLiteral(AWARDED_AT)})`
}

export function buildOwnerShowcaseTaskAssignmentInsert({ appId, ownerUserId, assignment }) {
  assertOwnerInput({ appId, ownerUserId })
  if (!assignment || !OWNER_SHOWCASE_TASK_ASSIGNMENTS.some(item => item.taskId === assignment.taskId && item.assignmentId === assignment.assignmentId)) {
    throw new Error('Owner showcase task assignment is not in the fixed TEST fixture allowlist')
  }
  return `INSERT INTO mip_task_assignments (
    id, app_id, task_id, user_id, status, version, assigned_by_user_id,
    assigned_at, revoked_by_user_id, revoked_at
  ) VALUES (
    ${sqlLiteral(assignment.assignmentId)}, ${sqlLiteral(appId)}, ${sqlLiteral(assignment.taskId)},
    ${sqlLiteral(ownerUserId)}, 'ACTIVE', 1, ${sqlLiteral(ownerUserId)},
    ${sqlLiteral(ASSIGNED_AT)}, NULL, NULL
  )`
}

export function ownerShowcaseFixtureSummary({ registeredEvents, paidEventOrders, activeBadges, equippedBadges, assignedTasks, profileReady, privateContactsReady, wrote }) {
  if (Number(registeredEvents) !== ALL_SHOWCASE_EVENTS.length
    || Number(paidEventOrders) !== 1
    || Number(activeBadges) !== OWNER_SHOWCASE_BADGES.length
    || Number(equippedBadges) !== OWNER_SHOWCASE_BADGES.length
    || Number(assignedTasks) !== OWNER_SHOWCASE_TASK_ASSIGNMENTS.length
    || Number(profileReady) !== 1
    || Number(privateContactsReady) !== 1) {
    throw new Error('Owner showcase fixture verification failed')
  }
  return {
    ready: true,
    fixture: 'TEST owner showcase',
    registeredEvents: Number(registeredEvents),
    paidEventOrders: Number(paidEventOrders),
    activeBadges: Number(activeBadges),
    equippedBadges: Number(equippedBadges),
    assignedTasks: Number(assignedTasks),
    profileReady: true,
    privateContactsReady: true,
    wrote: Number(wrote || 0),
  }
}

function binaryLiteral(value) {
  if (!Buffer.isBuffer(value) || value.length < 29) {
    throw new Error('Owner showcase encrypted contact is invalid')
  }
  return `X'${value.toString('hex')}'`
}

function assertOwnerInput({ appId, ownerUserId }) {
  if (!APP_ID_PATTERN.test(String(appId || '')) || !UUID_PATTERN.test(String(ownerUserId || ''))) {
    throw new Error('Owner showcase SQL input is invalid')
  }
}

function assertUuid(value, name) {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw new Error(`${name} is invalid`)
  }
}

function exactArgument(args, prefix) {
  const matches = args.filter(value => value.startsWith(prefix))
  return matches.length === 1 ? matches[0].slice(prefix.length) : ''
}
