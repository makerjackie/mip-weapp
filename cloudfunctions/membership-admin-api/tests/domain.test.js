'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  ACTIVITY_TYPES,
  EVENT_MODES,
  REGISTRATION_MODES,
  assertEventPublishable,
  assertEventTransition,
  assertRegistrationTransition,
  flagsFromActivityType,
  normalizeEvent,
  resolveActivityType,
} = require('../domain/events')
const { assertProfileTransition } = require('../domain/profiles')
const { assertCapability, capabilitiesFor } = require('../domain/rbac')

const caseRoot = path.resolve(__dirname, '../../..')

function digest(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(caseRoot, relativePath)))
    .digest('hex')
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function isoFromNow(hours) {
  return hoursFromNow(hours).toISOString()
}

function baseEvent(overrides = {}) {
  // Relative future windows so publishability does not expire with the calendar.
  const startsAt = overrides.startsAt || isoFromNow(48)
  const endsAt = overrides.endsAt || isoFromNow(50)
  const registrationDeadline = Object.prototype.hasOwnProperty.call(overrides, 'registrationDeadline')
    ? overrides.registrationDeadline
    : isoFromNow(24)
  return {
    title: '上海见面会',
    description: '线下交流',
    startsAt,
    endsAt,
    registrationDeadline,
    venueName: '静安创享中心',
    address: '上海市静安区南京西路 1000 号',
    location: '上海',
    capacity: 30,
    cancellationPolicy: '开始前 24 小时可取消',
    memberFree: true,
    priceCents: 0,
    version: 1,
    ...overrides,
    startsAt,
    endsAt,
    registrationDeadline,
  }
}

describe('admin RBAC', () => {
  it('keeps reviewer and support capabilities separate', () => {
    assert.deepEqual(capabilitiesFor('reviewer'), ['dashboard', 'profiles', 'reports'])
    assert.throws(() => assertCapability({ role: 'reviewer', status: 'ACTIVE' }, 'refunds'), /FORBIDDEN/)
    assert.doesNotThrow(() => assertCapability({ role: 'reviewer', status: 'ACTIVE' }, 'reports'))
    assert.doesNotThrow(() => assertCapability({ role: 'support', status: 'ACTIVE' }, 'refunds'))
  })
})

describe('admin event normalization', () => {
  it('normalizes a complete free event draft with UTC dates and version', () => {
    const event = normalizeEvent(baseEvent())
    assert.equal(event.capacity, 30)
    assert.equal(event.venueName, '静安创享中心')
    assert.equal(event.address, '上海市静安区南京西路 1000 号')
    assert.equal(event.location, '上海')
    assert.equal(event.cancellationPolicy, '开始前 24 小时可取消')
    assert.equal(event.version, 1)
    assert.equal(event.memberFree, true)
    assert.equal(event.priceCents, 0)
    assert.equal(event.activityType, ACTIVITY_TYPES.MEMBER_INCLUDED)
    assert.ok(event.startsAt instanceof Date)
    assert.ok(event.endsAt instanceof Date)
    assert.ok(event.registrationDeadline instanceof Date)
    assert.ok(event.endsAt.getTime() > event.startsAt.getTime())
    assert.ok(event.registrationDeadline.getTime() <= event.startsAt.getTime())
  })

  it('defaults endsAt to one hour after startsAt for legacy clients', () => {
    const startsAt = isoFromNow(48)
    const event = normalizeEvent({
      title: '上海见面会',
      description: '',
      startsAt,
      location: '上海',
      capacity: 30,
      memberFree: true,
      priceCents: 0,
    })
    assert.equal(event.endsAt.getTime() - event.startsAt.getTime(), 60 * 60 * 1000)
    assert.equal(event.activityType, ACTIVITY_TYPES.MEMBER_INCLUDED)
    assert.equal(event.version, 1)
  })

  it('accepts venue/address without legacy location and maps activity types', () => {
    const publicFree = normalizeEvent(baseEvent({
      location: undefined,
      memberFree: false,
      priceCents: 0,
      activityType: undefined,
    }))
    assert.equal(publicFree.location, '静安创享中心')
    assert.equal(publicFree.activityType, ACTIVITY_TYPES.PUBLIC_FREE)

    const paid = normalizeEvent(baseEvent({
      memberFree: false,
      priceCents: 9900,
      activityType: ACTIVITY_TYPES.PAID,
    }))
    assert.equal(paid.activityType, ACTIVITY_TYPES.PAID)
    assert.equal(paid.memberFree, false)
    assert.equal(paid.priceCents, 9900)

    assert.deepEqual(flagsFromActivityType(ACTIVITY_TYPES.MEMBER_INCLUDED), {
      memberFree: true,
      priceCents: 0,
    })
    assert.equal(resolveActivityType(0, false), ACTIVITY_TYPES.PUBLIC_FREE)
    assert.equal(resolveActivityType(0, true), ACTIVITY_TYPES.MEMBER_INCLUDED)
    assert.equal(resolveActivityType(100, false), ACTIVITY_TYPES.PAID)
  })

  it('normalizes approval, waitlist, map, and online event policies', () => {
    const event = normalizeEvent(baseEvent({
      registrationMode: REGISTRATION_MODES.APPROVAL,
      waitlistEnabled: true,
      eventMode: EVENT_MODES.HYBRID,
      latitude: 31.230416,
      longitude: 121.473701,
      onlineUrl: 'https://meeting.example.com/room',
    }))
    assert.equal(event.registrationMode, REGISTRATION_MODES.APPROVAL)
    assert.equal(event.waitlistEnabled, true)
    assert.equal(event.eventMode, EVENT_MODES.HYBRID)
    assert.equal(event.latitude, 31.230416)
    assert.equal(event.longitude, 121.473701)
    assert.equal(event.onlineUrl, 'https://meeting.example.com/room')

    assert.throws(
      () => normalizeEvent(baseEvent({
        activityType: ACTIVITY_TYPES.PAID,
        priceCents: 100,
        waitlistEnabled: true,
      })),
      /UNSUPPORTED_PAID_REGISTRATION_POLICY/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({
        eventMode: EVENT_MODES.ONLINE,
        onlineUrl: 'http://insecure.example.com',
      })),
      /INVALID_EVENT_ONLINE_URL/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ latitude: 31.2, longitude: null })),
      /INVALID_EVENT_COORDINATES/,
    )
  })

  it('rejects invalid time ranges, deadlines, lengths, and price combinations', () => {
    assert.throws(
      () => normalizeEvent(baseEvent({
        startsAt: isoFromNow(48),
        endsAt: isoFromNow(47),
      })),
      /INVALID_EVENT_TIME_RANGE/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({
        startsAt: isoFromNow(48),
        endsAt: isoFromNow(50),
        registrationDeadline: isoFromNow(72),
      })),
      /INVALID_EVENT_DEADLINE/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ title: 'x'.repeat(51) })),
      /INVALID_EVENT_TITLE/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ description: 'x'.repeat(2001) })),
      /INVALID_EVENT_DESCRIPTION/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ venueName: 'x'.repeat(121) })),
      /INVALID_EVENT_VENUE/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ address: 'x'.repeat(301) })),
      /INVALID_EVENT_ADDRESS/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ cancellationPolicy: 'x'.repeat(1001) })),
      /INVALID_EVENT_CANCELLATION_POLICY/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ capacity: 0 })),
      /INVALID_EVENT_CAPACITY/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ version: 0 })),
      /INVALID_EVENT_VERSION/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ memberFree: true, priceCents: 100 })),
      /INVALID_EVENT_PRICE_COMBINATION/,
    )
    assert.throws(
      () => resolveActivityType(100, true),
      /INVALID_EVENT_PRICE_COMBINATION/,
    )
    assert.throws(
      () => normalizeEvent(baseEvent({ coverAssetId: 'not-a-uuid' })),
      /INVALID_EVENT_COVER/,
    )
  })

  it('requires a future start when publishing against an injected clock', () => {
    const event = normalizeEvent(baseEvent({
      startsAt: isoFromNow(48),
      endsAt: isoFromNow(50),
      registrationDeadline: isoFromNow(24),
    }))
    assert.doesNotThrow(() => assertEventPublishable(event, hoursFromNow(0)))
    assert.throws(
      () => assertEventPublishable(event, hoursFromNow(72)),
      /INVALID_EVENT_STARTS_AT/,
    )
  })
})

describe('admin event state machine', () => {
  it('allows draft publish/cancel and published complete/cancel only', () => {
    assert.doesNotThrow(() => assertEventTransition('DRAFT', 'PUBLISHED'))
    assert.doesNotThrow(() => assertEventTransition('DRAFT', 'CANCELLED'))
    assert.doesNotThrow(() => assertEventTransition('PUBLISHED', 'COMPLETED'))
    assert.doesNotThrow(() => assertEventTransition('PUBLISHED', 'CANCELLED'))
    assert.throws(() => assertEventTransition('CANCELLED', 'PUBLISHED'), /INVALID_EVENT_TRANSITION/)
    assert.throws(() => assertEventTransition('COMPLETED', 'PUBLISHED'), /INVALID_EVENT_TRANSITION/)
    assert.throws(() => assertEventTransition('COMPLETED', 'CANCELLED'), /INVALID_EVENT_TRANSITION/)
    assert.throws(() => assertEventTransition('PUBLISHED', 'FINISHED'), /INVALID_EVENT_TRANSITION/)
    assert.throws(() => assertEventTransition('DRAFT', 'COMPLETED'), /INVALID_EVENT_TRANSITION/)
  })
})

describe('registration state machine', () => {
  it('allows check-in, cancel, and undo check-in but not free reopen of cancelled', () => {
    assert.doesNotThrow(() => assertRegistrationTransition('PENDING_REVIEW', 'REGISTERED'))
    assert.doesNotThrow(() => assertRegistrationTransition('PENDING_REVIEW', 'WAITLISTED'))
    assert.doesNotThrow(() => assertRegistrationTransition('PENDING_REVIEW', 'REJECTED'))
    assert.doesNotThrow(() => assertRegistrationTransition('WAITLISTED', 'REGISTERED'))
    assert.doesNotThrow(() => assertRegistrationTransition('WAITLISTED', 'CANCELLED'))
    assert.doesNotThrow(() => assertRegistrationTransition('REGISTERED', 'ATTENDED'))
    assert.doesNotThrow(() => assertRegistrationTransition('REGISTERED', 'CANCELLED'))
    assert.doesNotThrow(() => assertRegistrationTransition('ATTENDED', 'REGISTERED'))
    assert.doesNotThrow(() => assertRegistrationTransition('ATTENDED', 'ATTENDED'))
    assert.throws(
      () => assertRegistrationTransition('CANCELLED', 'REGISTERED'),
      /INVALID_REGISTRATION_TRANSITION/,
    )
    assert.throws(
      () => assertRegistrationTransition('CANCELLED', 'ATTENDED'),
      /INVALID_REGISTRATION_TRANSITION/,
    )
    assert.throws(
      () => assertRegistrationTransition('ATTENDED', 'CANCELLED'),
      /INVALID_REGISTRATION_TRANSITION/,
    )
  })
})

describe('activity operations migration contract', () => {
  it('locks all migration checksums including notifications and media failure tracking', () => {
    const lock = JSON.parse(
      fs.readFileSync(path.join(caseRoot, 'database/mysql/migrations.lock.json'), 'utf8'),
    )
    assert.equal(lock.version, 1)
    assert.equal(lock.migrations.length, 14)

    const first = lock.migrations[0]
    const second = lock.migrations[1]
    const third = lock.migrations[2]
    const fourth = lock.migrations[3]
    const fifth = lock.migrations[4]
    const sixth = lock.migrations[5]
    const seventh = lock.migrations[6]
    const eighth = lock.migrations[7]
    const ninth = lock.migrations[8]
    const tenth = lock.migrations[9]
    const eleventh = lock.migrations[10]
    const twelfth = lock.migrations[11]
    const thirteenth = lock.migrations[12]
    const fourteenth = lock.migrations[13]
    assert.equal(first.name, 'member_mysql_schema')
    assert.equal(first.version, '20260719010100')
    assert.equal(first.sqlSha256, digest(first.sql))
    assert.equal(first.rollbackSha256, digest(first.rollback))

    assert.equal(second.name, 'activity_operations')
    assert.equal(second.version, '20260723220000')
    assert.equal(second.sqlSha256, digest(second.sql))
    assert.equal(second.rollbackSha256, digest(second.rollback))

    assert.equal(third.name, 'export_integrity')
    assert.equal(third.version, '20260723230000')
    assert.equal(third.sqlSha256, digest(third.sql))
    assert.equal(third.rollbackSha256, digest(third.rollback))
    const exportSql = fs.readFileSync(path.join(caseRoot, third.sql), 'utf8')
    assert.match(exportSql, /member_export_tickets/)
    assert.match(exportSql, /member_mutation_idempotency/)
    assert.match(exportSql, /member_registrations_event_app_fk/)
    assert.match(exportSql, /file_id/)
    assert.match(exportSql, /content_sha256/)
    assert.match(exportSql, /RESERVED/)
    // Composite FKs include NOT NULL app_id — SET NULL is illegal; require RESTRICT.
    assert.match(exportSql, /member_profiles_avatar_app_fk[\s\S]*ON DELETE RESTRICT/)
    assert.match(exportSql, /member_events_cover_app_fk[\s\S]*ON DELETE RESTRICT/)
    assert.doesNotMatch(exportSql, /avatar_asset_id\)\s*REFERENCES[\s\S]*ON DELETE SET NULL/i)
    assert.doesNotMatch(exportSql, /cover_asset_id\)\s*REFERENCES[\s\S]*ON DELETE SET NULL/i)

    assert.equal(ninth.name, 'notifications_and_operations')
    assert.equal(ninth.version, '20260725050000')
    assert.equal(ninth.sqlSha256, digest(ninth.sql))
    assert.equal(ninth.rollbackSha256, digest(ninth.rollback))
    const notificationSql = fs.readFileSync(path.join(caseRoot, ninth.sql), 'utf8')
    assert.match(notificationSql, /member_notifications/)
    assert.match(notificationSql, /member_notification_subscriptions/)
    assert.match(notificationSql, /member_notification_outbox/)

    assert.equal(tenth.name, 'media_failure_tracking')
    assert.equal(tenth.version, '20260725060000')
    assert.equal(tenth.sqlSha256, digest(tenth.sql))
    assert.equal(tenth.rollbackSha256, digest(tenth.rollback))
    const mediaFailureSql = fs.readFileSync(path.join(caseRoot, tenth.sql), 'utf8')
    assert.match(mediaFailureSql, /member_operational_failures/)
    assert.match(mediaFailureSql, /MEDIA_REVIEW/)
    assert.doesNotMatch(mediaFailureSql, /BLOB|provider_payload/i)

    assert.equal(eleventh.name, 'event_participant_visibility')
    assert.equal(eleventh.version, '20260728090000')
    assert.equal(eleventh.sqlSha256, digest(eleventh.sql))
    assert.equal(eleventh.rollbackSha256, digest(eleventh.rollback))
    const participantVisibilitySql = fs.readFileSync(path.join(caseRoot, eleventh.sql), 'utf8')
    assert.match(participantVisibilitySql, /member_registrations[\s\S]*share_profile/)
    assert.match(participantVisibilitySql, /member_event_reservations[\s\S]*share_profile/)

    assert.equal(twelfth.name, 'community_foundation')
    assert.equal(twelfth.version, '20260728113000')
    assert.equal(twelfth.sqlSha256, digest(twelfth.sql))
    assert.equal(twelfth.rollbackSha256, digest(twelfth.rollback))
    const communitySql = fs.readFileSync(path.join(caseRoot, twelfth.sql), 'utf8')
    assert.match(communitySql, /member_announcements/)
    assert.match(communitySql, /member_blocks/)
    assert.match(communitySql, /member_reports/)

    assert.equal(thirteenth.name, 'event_owner_backfill')
    assert.equal(thirteenth.version, '20260728143000')
    assert.equal(thirteenth.sqlSha256, digest(thirteenth.sql))
    assert.equal(thirteenth.rollbackSha256, digest(thirteenth.rollback))
    const eventOwnerBackfillSql = fs.readFileSync(path.join(caseRoot, thirteenth.sql), 'utf8')
    const eventOwnerBackfillRollback = fs.readFileSync(path.join(caseRoot, thirteenth.rollback), 'utf8')
    assert.match(eventOwnerBackfillSql, /EVENT_OWNER_BACKFILL_PLANNED/)
    assert.match(eventOwnerBackfillSql, /INSERT INTO member_event_managers/)
    assert.match(eventOwnerBackfillSql, /'EVENT_OWNER'/)
    assert.match(eventOwnerBackfillRollback, /DELETE manager/)

    assert.equal(fourteenth.name, 'event_owner_backfill_v2')
    assert.equal(fourteenth.version, '20260728144500')
    assert.equal(fourteenth.sqlSha256, digest(fourteenth.sql))
    assert.equal(fourteenth.rollbackSha256, digest(fourteenth.rollback))
    const eventOwnerBackfillV2Sql = fs.readFileSync(path.join(caseRoot, fourteenth.sql), 'utf8')
    const eventOwnerBackfillV2Rollback = fs.readFileSync(path.join(caseRoot, fourteenth.rollback), 'utf8')
    assert.match(eventOwnerBackfillV2Sql, /EVENT_OWNER_BACKFILL_V2_PLANNED/)
    assert.match(eventOwnerBackfillV2Sql, /SELECT MIN\(candidate\.id\)/)
    assert.match(eventOwnerBackfillV2Sql, /INSERT INTO member_event_managers/)
    assert.match(eventOwnerBackfillV2Rollback, /DELETE manager/)

    assert.equal(fourth.name, 'media_cleanup_outbox')
    assert.equal(fourth.version, '20260724010000')
    assert.equal(fourth.sqlSha256, digest(fourth.sql))
    assert.equal(fourth.rollbackSha256, digest(fourth.rollback))
    const cleanupSql = fs.readFileSync(path.join(caseRoot, fourth.sql), 'utf8')
    assert.match(cleanupSql, /member_media_cleanup_outbox/)
    assert.match(cleanupSql, /next_retry_at/)
    assert.match(cleanupSql, /lease_until/)
    assert.match(cleanupSql, /member_media_cleanup_outbox_media_uk/)

    assert.equal(fifth.name, 'activity_platform')
    assert.equal(fifth.version, '20260725010000')
    assert.equal(fifth.sqlSha256, digest(fifth.sql))
    assert.equal(fifth.rollbackSha256, digest(fifth.rollback))
    const platformSql = fs.readFileSync(path.join(caseRoot, fifth.sql), 'utf8')
    for (const token of [
      'member_follows',
      'member_event_managers',
      'member_event_reservations',
      'member_event_photos',
      'member_checkin_credentials',
      'registration_schema',
      'answer_snapshot',
    ]) {
      assert.match(platformSql, new RegExp(token))
    }

    assert.equal(sixth.name, 'registration_ticket_backfill')
    assert.equal(sixth.version, '20260725020000')
    assert.equal(sixth.sqlSha256, digest(sixth.sql))
    assert.equal(sixth.rollbackSha256, digest(sixth.rollback))
    const ticketBackfillSql = fs.readFileSync(path.join(caseRoot, sixth.sql), 'utf8')
    const ticketBackfillRollback = fs.readFileSync(path.join(caseRoot, sixth.rollback), 'utf8')
    assert.match(ticketBackfillSql, /UPDATE member_registrations/)
    assert.match(ticketBackfillSql, /status IN \('REGISTERED', 'ATTENDED'\)/)
    assert.match(ticketBackfillSql, /ticket_code IS NULL OR ticket_code = ''/)
    assert.match(ticketBackfillSql, /SHA2\(CONCAT\(app_id, ':', id\), 256\)/)
    assert.doesNotMatch(ticketBackfillSql, /SELECT/)
    assert.match(ticketBackfillRollback, /SET ticket_code = NULL/)
    assert.match(ticketBackfillRollback, /ticket_code = CONCAT/)

    assert.equal(seventh.name, 'event_growth_core')
    assert.equal(seventh.version, '20260725030000')
    assert.equal(seventh.sqlSha256, digest(seventh.sql))
    assert.equal(seventh.rollbackSha256, digest(seventh.rollback))
    const eventGrowthSql = fs.readFileSync(path.join(caseRoot, seventh.sql), 'utf8')
    for (const token of [
      'registration_mode',
      'waitlist_enabled',
      'event_mode',
      'member_event_changes',
      'PENDING_REVIEW',
      'WAITLISTED',
    ]) {
      assert.match(eventGrowthSql, new RegExp(token))
    }
    assert.equal(eighth.name, 'event_role_simplification')
    assert.equal(eighth.version, '20260725040000')
    assert.equal(eighth.sqlSha256, digest(eighth.sql))
    assert.equal(eighth.rollbackSha256, digest(eighth.rollback))
    const roleSql = fs.readFileSync(path.join(caseRoot, eighth.sql), 'utf8')
    assert.match(roleSql, /EVENT_MANAGER/)
    assert.match(roleSql, /EVENT_STAFF/)
    assert.match(roleSql, /DROP CHECK member_event_managers_role_ck/)
    // Child nullability: avatar/cover asset ids remain nullable; app_id stays NOT NULL.
    const baseSchema = fs.readFileSync(path.join(caseRoot, first.sql), 'utf8')
    assert.match(baseSchema, /avatar_asset_id CHAR\(36\)[\s\S]*NULL/)
    assert.match(baseSchema, /app_id VARCHAR\(64\)[\s\S]*NOT NULL/)

    const sql = fs.readFileSync(path.join(caseRoot, second.sql), 'utf8')
    const rollback = fs.readFileSync(path.join(caseRoot, second.rollback), 'utf8')

    for (const token of [
      'venue_name',
      'cancellation_policy',
      'cancelled_at',
      'cancelled_by',
      'cancellation_reason',
      'version',
      'ticket_code',
      'attended_at',
      'attended_by',
      'cancelled_by_type',
      'member_registrations_ticket_uk',
      'member_registrations_roster_idx',
    ]) {
      assert.match(sql, new RegExp(token))
    }

    assert.doesNotMatch(sql, /ADD COLUMN registration_deadline/i)
    assert.doesNotMatch(sql, /ADD COLUMN cover_asset_id/i)
    assert.doesNotMatch(sql, /ADD COLUMN address/i)
    assert.doesNotMatch(rollback, /DROP TABLE/i)
    assert.match(rollback, /DROP COLUMN venue_name/)
    assert.match(rollback, /DROP COLUMN ticket_code/)
  })
})

describe('admin profile rules', () => {
  it('allows suspension and restoration without reopening rejected profiles', () => {
    assert.doesNotThrow(() => assertProfileTransition('APPROVED', 'SUSPENDED'))
    assert.doesNotThrow(() => assertProfileTransition('SUSPENDED', 'APPROVED'))
    assert.throws(() => assertProfileTransition('REJECTED', 'APPROVED'), /INVALID_PROFILE_TRANSITION/)
  })

  it('reviewProfile and setProfileStatus keep status UPDATE + audit in one transaction', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'index.js'),
      'utf8',
    )
    for (const fnName of ['async function reviewProfile', 'async function setProfileStatus']) {
      const start = source.indexOf(fnName)
      assert.ok(start >= 0, `${fnName} must exist`)
      const nextFn = source.indexOf('\nasync function ', start + fnName.length)
      const body = source.slice(start, nextFn > start ? nextFn : start + 2500)
      assert.match(body, /db\(\)\.transaction\s*\(/, `${fnName} must use db().transaction`)
      assert.match(body, /FOR UPDATE/, `${fnName} must lock the profile row`)
      assert.match(body, /UPDATE member_profiles/, `${fnName} must UPDATE profile status`)
      assert.match(body, /INSERT INTO member_audit_logs/, `${fnName} must INSERT audit in the same body`)
      // Audit must not be a separate top-level await audit(...) after the transaction.
      assert.doesNotMatch(
        body,
        /await audit\s*\(/,
        `${fnName} must not call the non-transactional audit() helper`,
      )
    }
  })
})

const {
  cancelEvent,
  duplicateEvent,
  mapEventRow,
  resolveCoverIntent,
  saveEvent,
  setEventStatus,
} = require('../lib/workflows')

function createFakeDb({
  existing = null,
  occupied = 0,
  updateAffected = 1,
  registrationAffected = 0,
  mediaAsset = null,
  failOn = null,
} = {}) {
  const statements = []
  const paramsLog = []
  const tx = {
    async one(sql, params = []) {
      statements.push(sql)
      paramsLog.push(params)
      if (sql.includes('FROM member_events') && sql.includes('FOR UPDATE')) {
        return existing
      }
      if (sql.includes('COUNT(*)') && sql.includes('member_registrations')) {
        return { total: occupied }
      }
      if (sql.includes('FROM member_media_assets')) {
        return mediaAsset
      }
      return null
    },
    async query(sql, params = []) {
      statements.push(sql)
      paramsLog.push(params)
      if (failOn && sql.includes(failOn)) {
        throw new Error('SIMULATED_SQL_FAILURE')
      }
      if (sql.includes('UPDATE member_registrations')) {
        return { affectedRows: registrationAffected }
      }
      if (sql.startsWith('UPDATE')) {
        return { affectedRows: updateAffected }
      }
      return { affectedRows: 1, insertId: 0 }
    },
  }
  return {
    statements,
    paramsLog,
    db: {
      async transaction(work) {
        return work(tx)
      },
    },
  }
}

function saveInput(overrides = {}) {
  return {
    title: '上海见面会',
    description: '线下交流',
    startsAt: isoFromNow(48),
    endsAt: isoFromNow(50),
    registrationDeadline: isoFromNow(24),
    venueName: '静安创享中心',
    address: '上海市静安区南京西路 1000 号',
    location: '上海',
    capacity: 30,
    cancellationPolicy: '开始前 24 小时可取消',
    activityType: ACTIVITY_TYPES.PUBLIC_FREE,
    ...overrides,
  }
}

describe('admin event authoring workflow', () => {
  it('maps public free and member included flags into the list DTO', () => {
    assert.throws(
      () => mapEventRow({
        id: '11111111-1111-4111-8111-111111111111',
        title: '公开沙龙',
        description: '说明',
        starts_at: '2027-01-02T02:00:00.000Z',
        ends_at: '2027-01-02T04:00:00.000Z',
        location: '上海',
        capacity: 20,
        version: null,
        member_free: 0,
        price_cents: 0,
        status: 'DRAFT',
      }),
      /DATA_INTEGRITY/,
    )

    const publicFree = mapEventRow({
      id: '11111111-1111-4111-8111-111111111111',
      title: '公开沙龙',
      description: '说明',
      starts_at: '2027-01-02T02:00:00.000Z',
      ends_at: '2027-01-02T04:00:00.000Z',
      registration_deadline: null,
      venue_name: '',
      address: '',
      location: '上海',
      capacity: 20,
      cancellation_policy: '',
      cover_asset_id: null,
      version: 1,
      member_free: 0,
      price_cents: 0,
      status: 'DRAFT',
    })
    assert.equal(publicFree.activityType, ACTIVITY_TYPES.PUBLIC_FREE)
    assert.equal(publicFree.memberFree, false)
    assert.equal(publicFree.version, 1)
    assert.equal(publicFree.endsAt, '2027-01-02T04:00:00.000Z')
    assert.equal(publicFree.registrationDeadline, null)

    const memberIncluded = mapEventRow({
      id: '22222222-2222-4222-8222-222222222222',
      title: '会员专属',
      description: '说明',
      starts_at: '2027-01-02T02:00:00.000Z',
      ends_at: '2027-01-02T04:00:00.000Z',
      registration_deadline: '2027-01-01T15:59:59.000Z',
      venue_name: '静安创享中心',
      address: '南京西路 1000 号',
      location: '上海',
      capacity: 20,
      cancellation_policy: '不可取消',
      cover_asset_id: null,
      version: 3,
      member_free: 1,
      price_cents: 0,
      status: 'PUBLISHED',
    })
    assert.equal(memberIncluded.activityType, ACTIVITY_TYPES.MEMBER_INCLUDED)
    assert.equal(memberIncluded.memberFree, true)
    assert.equal(memberIncluded.venueName, '静安创享中心')
    assert.equal(memberIncluded.version, 3)
    assert.equal(memberIncluded.registrationDeadline, '2027-01-01T15:59:59.000Z')
  })

  it('rejects illegal price/member_free combinations as EVENT_DATA_INTEGRITY', () => {
    assert.throws(
      () => mapEventRow({
        id: '22222222-2222-4222-8222-222222222222',
        title: '坏数据',
        description: '',
        starts_at: isoFromNow(48),
        ends_at: isoFromNow(50),
        member_free: 1,
        price_cents: 9900,
        status: 'DRAFT',
        version: 1,
      }),
      /EVENT_DATA_INTEGRITY/,
    )
  })

  it('treats omitted cover as keep, null as clear, and UUID as replace with media check', async () => {
    assert.deepEqual(resolveCoverIntent({ title: 'x' }), { kind: 'omit' })
    assert.deepEqual(resolveCoverIntent({ coverAssetId: null }), { kind: 'clear' })
    assert.deepEqual(resolveCoverIntent({ coverAssetId: '' }), { kind: 'clear' })
    const coverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    assert.deepEqual(resolveCoverIntent({ coverAssetId: coverId }), { kind: 'set', id: coverId })

    const eventId = '33333333-3333-4333-8333-333333333333'
    const existingCover = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const keep = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        cover_asset_id: existingCover,
        price_cents: 0,
        member_free: 0,
      },
    })
    await saveEvent(keep.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ id: eventId, version: 1 }),
    })
    const keepUpdate = keep.paramsLog[keep.statements.findIndex(sql => sql.includes('UPDATE member_events SET'))]
    assert.equal(keepUpdate[24], existingCover)

    const clear = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        cover_asset_id: existingCover,
        price_cents: 0,
        member_free: 0,
      },
    })
    await saveEvent(clear.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ id: eventId, version: 1, coverAssetId: null }),
    })
    const clearUpdate = clear.paramsLog[clear.statements.findIndex(sql => sql.includes('UPDATE member_events SET'))]
    assert.equal(clearUpdate[24], null)

    const replace = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        cover_asset_id: existingCover,
        price_cents: 0,
        member_free: 0,
      },
      mediaAsset: { id: coverId },
    })
    await saveEvent(replace.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ id: eventId, version: 1, coverAssetId: coverId }),
    })
    assert.ok(replace.statements.some(sql =>
      sql.includes('member_media_assets')
      && sql.includes("status = 'READY'")
      && sql.includes("kind = 'event-cover'")))
    const replaceUpdate = replace.paramsLog[replace.statements.findIndex(sql => sql.includes('UPDATE member_events SET'))]
    assert.equal(replaceUpdate[24], coverId)

    const crossTenant = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        cover_asset_id: existingCover,
        price_cents: 0,
        member_free: 0,
      },
      mediaAsset: null,
    })
    await assert.rejects(
      () => saveEvent(crossTenant.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({ id: eventId, version: 1, coverAssetId: coverId }),
      }),
      /INVALID_EVENT_COVER/,
    )
  })

  it('creates a public free draft with version 1 and full field SQL', async () => {
    const fake = createFakeDb()
    const result = await saveEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ activityType: ACTIVITY_TYPES.PUBLIC_FREE }),
    })
    assert.equal(result.version, 1)
    assert.match(result.id, /^[0-9a-f-]{36}$/i)
    const insert = fake.statements.find(sql => sql.includes('INSERT INTO member_events'))
    assert.ok(insert)
    assert.match(insert, /registration_deadline/)
    assert.match(insert, /venue_name/)
    assert.match(insert, /cancellation_policy/)
    assert.match(insert, /version/)
    assert.match(insert, /'DRAFT'/)
    const insertParams = fake.paramsLog[fake.statements.indexOf(insert)]
    assert.equal(insertParams[23], 0)
    assert.equal(insertParams[24], 0)
    const ownerInsert = fake.statements.find(sql => sql.includes('INSERT INTO member_event_managers'))
    assert.ok(ownerInsert)
    assert.match(ownerInsert, /'EVENT_OWNER', 'ACTIVE'/)
    assert.deepEqual(fake.paramsLog[fake.statements.indexOf(ownerInsert)], [
      'wx-app',
      result.id,
      'owner-1',
      'owner-1',
    ])
    assert.ok(fake.statements.some(sql => sql.includes('EVENT_CREATED')))
  })

  it('duplicates only reusable event configuration into a future draft', async () => {
    const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const source = {
      id: sourceId,
      title: '每周缝纫交流会',
      summary: '一起做衣服',
      description: '活动详情',
      notices: '请自带工具',
      registration_schema: [{ key: 'experience', label: '缝纫经验' }],
      form_version: 3,
      registration_mode: 'APPROVAL',
      waitlist_enabled: 1,
      album_enabled: 1,
      album_requires_review: 1,
      event_mode: 'OFFLINE',
      starts_at: '2027-01-08T10:00:00.000Z',
      ends_at: '2027-01-08T12:00:00.000Z',
      registration_deadline: '2027-01-07T10:00:00.000Z',
      location: '上海',
      venue_name: '缝纫工作室',
      address: '南京西路 1000 号',
      latitude: 31.23,
      longitude: 121.47,
      online_url: null,
      capacity: 24,
      member_free: 1,
      price_cents: 0,
      cancellation_policy: '活动前一天可取消',
      cover_asset_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      poster_asset_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }
    const statements = []
    const paramsLog = []
    const db = {
      async transaction(work) {
        return work({
          async one(sql, params) {
            statements.push(sql)
            paramsLog.push(params)
            return source
          },
          async query(sql, params) {
            statements.push(sql)
            paramsLog.push(params)
            return { affectedRows: 1 }
          },
        })
      },
    }

    const result = await duplicateEvent(db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      eventId: sourceId,
      now: new Date('2027-01-01T00:00:00.000Z'),
    })

    assert.match(result.id, /^[0-9a-f-]{36}$/i)
    assert.equal(result.version, 1)
    const sourceQuery = statements.find(sql => sql.includes('SELECT * FROM member_events'))
    assert.match(sourceQuery, /WHERE app_id = \? AND id = \?/)
    assert.deepEqual(paramsLog[statements.indexOf(sourceQuery)], ['wx-app', sourceId])

    const insert = statements.find(sql => sql.includes('INSERT INTO member_events'))
    const insertParams = paramsLog[statements.indexOf(insert)]
    assert.match(insert, /'DRAFT', 1/)
    assert.equal(insertParams[2], '每周缝纫交流会（副本）')
    assert.deepEqual(JSON.parse(insertParams[6]), source.registration_schema)
    assert.equal(insertParams[7], 3)
    assert.equal(insertParams[8], 'APPROVAL')
    assert.equal(insertParams[9], 1)
    assert.equal(insertParams[10], 1)
    assert.equal(insertParams[11], 1)
    assert.equal(insertParams[13].toISOString(), '2027-01-15T10:00:00.000Z')
    assert.equal(insertParams[14].toISOString(), '2027-01-15T12:00:00.000Z')
    assert.equal(insertParams[15].toISOString(), '2027-01-14T10:00:00.000Z')
    assert.equal(insertParams[22], 24)
    assert.equal(insertParams[26], source.cover_asset_id)
    assert.equal(insertParams[27], source.poster_asset_id)

    const ownerInsert = statements.find(sql => sql.includes('INSERT INTO member_event_managers'))
    assert.ok(ownerInsert)
    assert.match(ownerInsert, /'EVENT_OWNER', 'ACTIVE'/)
    assert.deepEqual(paramsLog[statements.indexOf(ownerInsert)], [
      'wx-app',
      result.id,
      'owner-1',
      'owner-1',
    ])

    const audit = statements.find(sql => sql.includes('EVENT_DUPLICATED'))
    assert.ok(audit)
    const auditParams = paramsLog[statements.indexOf(audit)]
    assert.equal(JSON.parse(auditParams.at(-1)).sourceEventId, sourceId)
    assert.ok(!statements.some(sql =>
      /member_registrations|member_orders|member_event_albums/.test(sql)))
  })

  it('creates a member included draft with member_free=1 and price_cents=0', async () => {
    const fake = createFakeDb()
    await saveEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ activityType: ACTIVITY_TYPES.MEMBER_INCLUDED }),
    })
    const insert = fake.statements.find(sql => sql.includes('INSERT INTO member_events'))
    const insertParams = fake.paramsLog[fake.statements.indexOf(insert)]
    assert.equal(insertParams[23], 1)
    assert.equal(insertParams[24], 0)
  })

  it('updates with expected version and increments version in SQL', async () => {
    const eventId = '33333333-3333-4333-8333-333333333333'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 2,
        cover_asset_id: null,
      },
      occupied: 5,
      updateAffected: 1,
    })
    const result = await saveEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({
        id: eventId,
        version: 2,
        capacity: 10,
        activityType: ACTIVITY_TYPES.PUBLIC_FREE,
      }),
    })
    assert.equal(result.id, eventId)
    assert.equal(result.version, 3)
    const update = fake.statements.find(sql => sql.includes('UPDATE member_events SET'))
    assert.ok(update)
    assert.match(update, /version = version \+ 1/)
    assert.match(update, /WHERE id = \? AND app_id = \? AND version = \?/)
    assert.ok(fake.statements.some(sql => sql.includes('FOR UPDATE')))
    const updateParams = fake.paramsLog[fake.statements.indexOf(update)]
    assert.equal(updateParams.at(-1), 2)
    assert.equal(updateParams.at(-2), 'wx-app')
    assert.equal(updateParams.at(-3), eventId)
  })

  it('rejects stale version updates as EVENT_VERSION_CONFLICT', async () => {
    const eventId = '44444444-4444-4444-8444-444444444444'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 4,
        cover_asset_id: null,
        starts_at: hoursFromNow(48).toISOString(),
      },
      occupied: 0,
      updateAffected: 0,
    })
    await assert.rejects(
      () => saveEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({ id: eventId, version: 3 }),
      }),
      /EVENT_VERSION_CONFLICT/,
    )
  })

  it('rejects capacity below current REGISTERED/ATTENDED count', async () => {
    const eventId = '55555555-5555-4555-8555-555555555555'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 1,
        cover_asset_id: null,
        starts_at: hoursFromNow(48).toISOString(),
      },
      occupied: 12,
    })
    await assert.rejects(
      () => saveEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({ id: eventId, version: 1, capacity: 10 }),
      }),
      /EVENT_CAPACITY_BELOW_REGISTRATIONS/,
    )
    assert.ok(fake.statements.some(sql => sql.includes('member_registrations')))
    assert.ok(!fake.statements.some(sql => sql.includes('UPDATE member_events SET')))
  })

  it('creates a paid draft from the same server-owned activity type mapping', async () => {
    const fake = createFakeDb()
    await saveEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      value: saveInput({ activityType: ACTIVITY_TYPES.PAID, priceCents: 9900 }),
    })
    const insert = fake.statements.find(sql => sql.includes('INSERT INTO member_events'))
    const insertParams = fake.paramsLog[fake.statements.indexOf(insert)]
    assert.equal(insertParams[23], 0)
    assert.equal(insertParams[24], 9900)
  })

  it('requires a future start when publishing and matches expected version', async () => {
    const eventId = '66666666-6666-4666-8666-666666666666'
    const clock = hoursFromNow(0)
    const past = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        title: '旧活动',
        description: '说明',
        starts_at: hoursFromNow(-24).toISOString(),
        ends_at: hoursFromNow(-22).toISOString(),
        registration_deadline: null,
        venue_name: '场地',
        address: '地址',
        location: '上海',
        capacity: 20,
        cancellation_policy: '',
        cover_asset_id: null,
        member_free: 0,
        price_cents: 0,
        version: 1,
      },
    })
    await assert.rejects(
      () => setEventStatus(past.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        status: 'PUBLISHED',
        expectedVersion: 1,
        now: clock,
      }),
      /INVALID_EVENT_STARTS_AT/,
    )
    assert.ok(past.statements.some(sql => sql.includes('FOR UPDATE')))

    const future = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        title: '新活动',
        description: '说明',
        starts_at: hoursFromNow(48).toISOString(),
        ends_at: hoursFromNow(50).toISOString(),
        registration_deadline: hoursFromNow(24).toISOString(),
        venue_name: '场地',
        address: '地址',
        location: '上海',
        capacity: 20,
        cancellation_policy: '开始前可取消',
        cover_asset_id: null,
        member_free: 1,
        price_cents: 0,
        version: 1,
      },
    })
    const published = await setEventStatus(future.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      eventId,
      status: 'PUBLISHED',
      expectedVersion: 1,
      now: clock,
    })
    assert.deepEqual(published, { id: eventId, status: 'PUBLISHED', version: 2 })
    const statusUpdate = future.statements.find(sql => sql.includes('UPDATE member_events SET'))
    assert.ok(statusUpdate)
    assert.match(statusUpdate, /version = version \+ 1/)
    assert.match(statusUpdate, /WHERE id = \? AND app_id = \? AND version = \? AND status = \?/)
    assert.ok(future.statements.some(sql => sql.includes('EVENT_PUBLISHED')))
  })

  it('returns the same status fact without re-auditing when already published', async () => {
    const eventId = '88888888-8888-4888-8888-888888888888'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 4,
        starts_at: hoursFromNow(48).toISOString(),
      },
    })
    const result = await setEventStatus(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      eventId,
      status: 'PUBLISHED',
      expectedVersion: 4,
    })
    assert.deepEqual(result, { id: eventId, status: 'PUBLISHED', version: 4 })
    assert.ok(!fake.statements.some(sql => sql.includes('UPDATE member_events')))
    assert.ok(!fake.statements.some(sql => sql.includes('EVENT_PUBLISHED')))
  })

  it('rejects stale setEventStatus versions as EVENT_VERSION_CONFLICT', async () => {
    const eventId = '99999999-9999-4999-8999-999999999999'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 3,
        title: '活动',
        description: '',
        starts_at: hoursFromNow(48).toISOString(),
        ends_at: hoursFromNow(50).toISOString(),
        registration_deadline: null,
        venue_name: '场地',
        address: '地址',
        location: '上海',
        capacity: 10,
        cancellation_policy: '',
        cover_asset_id: null,
        member_free: 0,
        price_cents: 0,
      },
      updateAffected: 0,
    })
    await assert.rejects(
      () => setEventStatus(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        status: 'PUBLISHED',
        expectedVersion: 2,
        now: hoursFromNow(0),
      }),
      /EVENT_VERSION_CONFLICT/,
    )
  })

  it('rejects generic CANCELLED status and requires cancelEvent', async () => {
    const eventId = '77777777-7777-4777-8777-777777777777'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
        version: 1,
      },
    })
    await assert.rejects(
      () => setEventStatus(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        status: 'CANCELLED',
        expectedVersion: 1,
      }),
      /EVENT_CANCEL_REQUIRES_ACTION/,
    )
    assert.equal(fake.statements.length, 0)
  })

  it('revalidates publishable rules when updating a PUBLISHED event', async () => {
    const eventId = 'abababab-abab-4aba-8aba-abababababab'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 2,
        cover_asset_id: null,
        price_cents: 0,
        member_free: 0,
        starts_at: hoursFromNow(48).toISOString(),
      },
      occupied: 0,
    })
    await assert.rejects(
      () => saveEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({
          id: eventId,
          version: 2,
          startsAt: hoursFromNow(-2).toISOString(),
          endsAt: hoursFromNow(1).toISOString(),
          registrationDeadline: null,
        }),
        now: hoursFromNow(0),
      }),
      /INVALID_EVENT_STARTS_AT/,
    )
  })

  it('rejects editing a PUBLISHED event whose persisted starts_at is already past', async () => {
    const eventId = 'acacacac-acac-4aca-8aca-acacacacacac'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 3,
        cover_asset_id: null,
        price_cents: 0,
        member_free: 0,
        starts_at: hoursFromNow(-1).toISOString(),
        ends_at: hoursFromNow(2).toISOString(),
      },
      occupied: 2,
    })
    await assert.rejects(
      () => saveEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({
          id: eventId,
          version: 3,
          // Payload is in the future; persisted start still blocks rewrites.
          startsAt: hoursFromNow(48).toISOString(),
          endsAt: hoursFromNow(50).toISOString(),
        }),
        now: hoursFromNow(0),
      }),
      /EVENT_ALREADY_STARTED/,
    )
    assert.ok(!fake.statements.some(sql => sql.startsWith('UPDATE member_events')))
  })

  it('locks free eligibility switches when REGISTERED/ATTENDED rows exist', async () => {
    const eventId = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd'
    const fake = createFakeDb({
      existing: {
        id: eventId,
        status: 'PUBLISHED',
        version: 1,
        cover_asset_id: null,
        price_cents: 0,
        member_free: 0,
        starts_at: hoursFromNow(48).toISOString(),
      },
      occupied: 3,
    })
    await assert.rejects(
      () => saveEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({
          id: eventId,
          version: 1,
          activityType: ACTIVITY_TYPES.MEMBER_INCLUDED,
        }),
        now: hoursFromNow(0),
      }),
      /EVENT_ELIGIBILITY_LOCKED/,
    )
    assert.ok(!fake.statements.some(sql => sql.includes('UPDATE member_events SET')))
  })

  it('rolls back create/update/status when audit INSERT fails', async () => {
    const createFail = createFakeDb({ failOn: 'EVENT_CREATED' })
    await assert.rejects(
      () => saveEvent(createFail.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput(),
      }),
      /SIMULATED_SQL_FAILURE/,
    )
    assert.ok(createFail.statements.some(sql => sql.includes('INSERT INTO member_events')))

    const eventId = 'dededede-dede-4ded-8ded-dededededede'
    const updateFail = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        cover_asset_id: null,
        price_cents: 0,
        member_free: 0,
      },
      failOn: 'EVENT_UPDATED',
    })
    await assert.rejects(
      () => saveEvent(updateFail.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        value: saveInput({ id: eventId, version: 1 }),
      }),
      /SIMULATED_SQL_FAILURE/,
    )

    const statusFail = createFakeDb({
      existing: {
        id: eventId,
        status: 'DRAFT',
        title: '活动',
        description: '',
        starts_at: hoursFromNow(48).toISOString(),
        ends_at: hoursFromNow(50).toISOString(),
        registration_deadline: null,
        venue_name: '场地',
        address: '地址',
        location: '上海',
        capacity: 10,
        cancellation_policy: '',
        cover_asset_id: null,
        member_free: 0,
        price_cents: 0,
        version: 1,
      },
      failOn: 'EVENT_PUBLISHED',
    })
    await assert.rejects(
      () => setEventStatus(statusFail.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        status: 'PUBLISHED',
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /SIMULATED_SQL_FAILURE/,
    )
    assert.ok(statusFail.statements.some(sql => sql.includes('UPDATE member_events SET')))
  })
})

describe('admin cancelEvent convergence', () => {
  const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  function futurePublished(overrides = {}) {
    return {
      id: eventId,
      app_id: 'wx-app',
      status: 'PUBLISHED',
      starts_at: hoursFromNow(72).toISOString(),
      version: 3,
      cancelled_at: null,
      cancellation_reason: null,
      ...overrides,
    }
  }

  it('converges REGISTERED rows, keeps ATTENDED, and audits affected count only', async () => {
    const fake = createFakeDb({
      existing: futurePublished(),
      updateAffected: 1,
      registrationAffected: 2,
    })
    const result = await cancelEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      eventId,
      reason: '场地临时不可用',
      expectedVersion: 3,
      now: hoursFromNow(0),
    })
    assert.equal(result.status, 'CANCELLED')
    assert.equal(result.version, 4)
    assert.equal(result.affectedCount, 2)
    assert.equal(result.cancellationReason, '场地临时不可用')
    assert.ok(fake.statements.some(sql => sql.includes('FOR UPDATE')))
    assert.ok(fake.statements.some(sql =>
      sql.includes('UPDATE member_events')
      && sql.includes("status = 'CANCELLED'")
      && sql.includes('cancelled_by')
      && sql.includes('cancellation_reason')
      && sql.includes('version = version + 1')))
    const regUpdate = fake.statements.find(sql => sql.includes('UPDATE member_registrations'))
    assert.ok(regUpdate)
    assert.match(
      regUpdate,
      /status IN \('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED'\)/,
    )
    assert.match(regUpdate, /cancelled_by_type = 'EVENT'/)
    assert.doesNotMatch(regUpdate, /ATTENDED/)
    const audit = fake.statements.find(sql => sql.includes('EVENT_CANCELLED'))
    assert.ok(audit)
    assert.match(audit, /'EVENT_CANCELLED'/)
    const auditParams = fake.paramsLog[fake.statements.indexOf(audit)]
    assert.deepEqual(auditParams.slice(0, 4), ['wx-app', 'owner-1', 'owner', eventId])
    assert.equal(JSON.parse(auditParams[4]).affectedCount, 2)
    assert.deepEqual(Object.keys(JSON.parse(auditParams[4])), ['affectedCount', 'refundCount'])
  })

  it('is idempotent for already CANCELLED events without re-writing registrations or audit', async () => {
    const cancelledAt = hoursFromNow(-24).toISOString()
    const fake = createFakeDb({
      existing: futurePublished({
        status: 'CANCELLED',
        version: 5,
        cancelled_at: cancelledAt,
        cancellation_reason: '原取消原因',
      }),
    })
    const result = await cancelEvent(fake.db, {
      appId: 'wx-app',
      actorId: 'owner-1',
      actorRole: 'owner',
      eventId,
      reason: '重复提交的原因',
      expectedVersion: 1,
      now: hoursFromNow(0),
    })
    assert.equal(result.status, 'CANCELLED')
    assert.equal(result.version, 5)
    assert.equal(result.affectedCount, 0)
    assert.equal(result.cancellationReason, '原取消原因')
    assert.equal(result.cancelledAt, cancelledAt)
    assert.ok(!fake.statements.some(sql => sql.includes('UPDATE member_registrations')))
    assert.ok(!fake.statements.some(sql => sql.includes('EVENT_CANCELLED')))
    assert.ok(!fake.statements.some(sql => sql.includes('UPDATE member_events')))
  })

  it('rejects started and completed events', async () => {
    const started = createFakeDb({
      existing: futurePublished({
        starts_at: hoursFromNow(-1).toISOString(),
      }),
    })
    await assert.rejects(
      () => cancelEvent(started.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        reason: '太晚了',
        expectedVersion: 3,
        now: hoursFromNow(0),
      }),
      /EVENT_ALREADY_STARTED/,
    )

    const completed = createFakeDb({
      existing: futurePublished({
        status: 'COMPLETED',
      }),
    })
    await assert.rejects(
      () => cancelEvent(completed.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        reason: '结束后不可取消',
        expectedVersion: 3,
        now: hoursFromNow(0),
      }),
      /EVENT_ALREADY_COMPLETED/,
    )
  })

  it('rejects cross-app missing events and version conflicts', async () => {
    const missing = createFakeDb({ existing: null })
    await assert.rejects(
      () => cancelEvent(missing.db, {
        appId: 'wx-other',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        reason: '跨租户',
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /INVALID_EVENT/,
    )

    const conflict = createFakeDb({
      existing: futurePublished(),
      updateAffected: 0,
    })
    await assert.rejects(
      () => cancelEvent(conflict.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        reason: '版本过期',
        expectedVersion: 2,
        now: hoursFromNow(0),
      }),
      /EVENT_VERSION_CONFLICT/,
    )
  })

  it('rolls back when a later SQL step fails (no partial success surface)', async () => {
    const fake = createFakeDb({
      existing: futurePublished(),
      updateAffected: 1,
      registrationAffected: 1,
      failOn: 'EVENT_CANCELLED',
    })
    await assert.rejects(
      () => cancelEvent(fake.db, {
        appId: 'wx-app',
        actorId: 'owner-1',
        actorRole: 'owner',
        eventId,
        reason: '审计失败应回滚',
        expectedVersion: 3,
        now: hoursFromNow(0),
      }),
      /SIMULATED_SQL_FAILURE/,
    )
    assert.ok(fake.statements.some(sql => sql.includes('UPDATE member_events')))
    assert.ok(fake.statements.some(sql => sql.includes('UPDATE member_registrations')))
  })
})
