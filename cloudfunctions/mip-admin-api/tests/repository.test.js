'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

function createAdminRepository(database, options) {
  return createProductionAdminRepository(database, withTestAuthorization(options))
}

function transactionDatabase({ one = async () => null, query = async () => ({ affectedRows: 1 }) } = {}) {
  return {
    one,
    query,
    async transaction(work) {
      return work({ one, query })
    },
  }
}

function audit(overrides = {}) {
  return {
    appId: 'wx-app',
    actorUserId: 'admin-user',
    scopeType: 'EVENT',
    scopeId: 'event-a',
    action: 'admin.events.status.change',
    resourceType: 'EVENT',
    resourceId: 'event-a',
    effectiveRole: 'PLATFORM_OWNER',
    metadata: {},
    ...overrides,
  }
}

function growthLevelDraft(overrides = {}) {
  return {
    levelKey: 'member',
    name: '会员',
    minimumExperience: 0,
    benefits: [],
    status: 'ACTIVE',
    ...overrides,
  }
}

function growthRuleDraft(overrides = {}) {
  return {
    ruleKey: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    deltaValue: 10,
    dailyLimitValue: null,
    sourceEventType: 'event.checked_in',
    status: 'ACTIVE',
    ...overrides,
  }
}

describe('admin repository persistence contracts', () => {
  it('proves health with a real SELECT 1 query', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        calls.push({ sql, params })
        return { ok: 1 }
      },
    }))
    assert.equal(await repository.health(), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].sql, 'SELECT 1 AS ok')
  })

  it('counts events without multiplying them by registration joins', async () => {
    const sqlCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        sqlCalls.push(sql)
        return {}
      },
    }))
    await repository.dashboard('wx-app', { platform: true, branchIds: [], eventIds: [] })
    const eventSql = sqlCalls.find(sql => sql.includes('AS total_events'))
    assert.ok(eventSql)
    assert.doesNotMatch(eventSql, /LEFT JOIN mip_event_registrations/)
    assert.match(eventSql, /SELECT COUNT\(\*\) FROM mip_event_registrations/)
  })

  it('makes an active blacklist effective through mip_users and records the audit', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          return { id: 'user-a', status: 'ACTIVE', primary_branch_id: 'branch-a' }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => 'control-a' })
    await repository.setUserControl({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      userId: 'user-a',
      controlType: 'BLOCKLIST',
      active: true,
      reason: '违反社区规则',
      authorizedScope: { scopeType: 'BRANCH', scopeId: 'branch-a' },
      audit: audit({ scopeType: 'BRANCH', scopeId: 'branch-a' }),
    })
    assert.ok(calls.some(call => call.sql.includes("mip_users SET status = 'BLOCKED'")))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
    const controlInsert = calls.find(call => call.sql.includes('INSERT INTO mip_user_access_controls'))
    assert.equal(controlInsert.params[5], 'ACTIVE')
  })

  it('fails closed before user-control writes when the locked user moved branches', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          return { id: 'user-a', status: 'ACTIVE', primary_branch_id: 'branch-b' }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.setUserControl({
      appId: 'wx-app', actorUserId: 'admin-user', userId: 'user-a',
      controlType: 'BLOCKLIST', active: true, reason: '违反社区规则',
      authorizedScope: { scopeType: 'BRANCH', scopeId: 'branch-a' },
      audit: audit({ scopeType: 'BRANCH', scopeId: 'branch-a' }),
    }), /CONFLICT/)
    assert.equal(calls.length, 0)
  })

  it('does not restore controls or append growth after account closure', async () => {
    for (const invoke of [
      repository => repository.setUserControl({
        appId: 'wx-app', actorUserId: 'admin-user', userId: 'user-a',
        controlType: 'ALLOWLIST', active: true, reason: '运营复核',
        authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
        audit: audit({ scopeType: 'PLATFORM', scopeId: null }),
      }),
      repository => repository.adjustGrowth({
        appId: 'wx-app', actorUserId: 'admin-user', userId: 'user-a',
        metric: 'EXPERIENCE', deltaValue: 5, reason: '运营补录',
        idempotencyKey: 'closed-user-adjustment',
        authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
        audit: () => audit({ scopeType: 'PLATFORM', scopeId: null }),
      }),
    ]) {
      let writes = 0
      const repository = createAdminRepository(transactionDatabase({
        async one(sql) {
          if (sql.includes('FROM mip_users')) {
            return { id: 'user-a', status: 'CLOSED', primary_branch_id: null }
          }
          return null
        },
        async query() { writes += 1; return { affectedRows: 1 } },
      }))
      await assert.rejects(() => invoke(repository), /INVALID_STATE/)
      assert.equal(writes, 0)
    }
  })

  it('cancels active registrations transactionally and emits durable facts', async () => {
    const calls = []
    let nextId = 0
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return {
            status: 'PUBLISHED',
            content_safety_status: 'PASSED',
            starts_at: new Date('2026-08-25T10:00:00.000Z'),
            version: 4,
          }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_event_registrations r')) {
          return [{
            id: 'registration-a',
            user_id: 'user-a',
            status: 'REGISTERED',
            version: 2,
            order_id: null,
            order_status: null,
            amount_cents: null,
            reserved_refund_cents: 0,
            seat_hold_id: null,
          }]
        }
        return { affectedRows: 1 }
      },
    }), {
      id: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })
    const result = await repository.changeEventStatus({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      eventId: 'event-a',
      expectedVersion: 4,
      status: 'CANCELLED',
      reason: '场地无法使用',
      audit: audit(),
    })
    assert.deepEqual(result, {
      id: 'event-a', status: 'CANCELLED', version: 5, affectedCount: 1, refundIds: [],
    })
    assert.ok(calls.some(call => call.sql.includes('UPDATE mip_event_registrations')))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_event_changes')))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
    assert.equal(calls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
  })

  it('returns server-created refund identifiers for post-commit provider dispatch', async () => {
    const calls = []
    let nextId = 0
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return {
            status: 'PUBLISHED', content_safety_status: 'PASSED',
            starts_at: new Date('2026-08-25T10:00:00.000Z'), version: 4,
          }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_event_registrations r')) {
          return [{
            id: 'registration-paid', user_id: 'buyer-user', status: 'REGISTERED', version: 2,
            order_id: 'order-paid', order_status: 'PAID', amount_cents: 12000,
            reserved_refund_cents: 0, seat_hold_id: 'hold-paid',
          }]
        }
        return { affectedRows: 1 }
      },
    }), {
      id: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })
    const result = await repository.changeEventStatus({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', expectedVersion: 4,
      status: 'CANCELLED', reason: '场地无法使用', audit: audit(),
    })
    assert.equal(result.refundIds.length, 1)
    const insert = calls.find(call => call.sql.includes('INSERT INTO mip_refunds'))
    assert.equal(insert.params[6], 12000)
    assert.equal(insert.params[3], 'buyer-user')
    assert.equal(insert.params[0], result.refundIds[0])
    assert.ok(calls.some(call => call.sql.includes("UPDATE mip_orders SET status = 'REFUND_PENDING'")))
  })

  it('approves a reviewed registration only after locked capacity and hold checks', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return {
            id: 'event-a', access_type: 'FREE', registration_policy: 'APPROVAL',
            status: 'PUBLISHED', capacity: 20, waitlist_enabled: 1,
          }
        }
        if (sql.includes('FROM mip_event_registrations') && sql.includes('FOR UPDATE')) {
          return { id: 'registration-a', user_id: 'user-a', order_id: null, status: 'PENDING_REVIEW', version: 3 }
        }
        if (sql.includes('COUNT(*)') && sql.includes('mip_event_registrations')) return { total: 18 }
        if (sql.includes('COUNT(*)') && sql.includes('mip_event_seat_holds')) return { total: 1 }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), {
      id: () => '00000000-0000-4000-8000-000000000001',
      randomBytes: () => Buffer.alloc(24, 7),
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })
    const result = await repository.reviewRegistration({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', registrationId: 'registration-a',
      expectedVersion: 3, decision: 'APPROVE', audit: status => audit({
        action: 'admin.events.registration.approve', resourceType: 'EVENT_REGISTRATION',
        resourceId: 'registration-a', metadata: { status },
      }),
    })
    assert.deepEqual(result, { id: 'registration-a', status: 'REGISTERED', version: 4 })
    const registrationUpdate = calls.find(call => call.sql.includes('UPDATE mip_event_registrations SET status = ?'))
    assert.equal(registrationUpdate.params[0], 'REGISTERED')
    assert.match(registrationUpdate.params[1], /^[0-9a-f]{64}$/)
    const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.equal(outbox.params[4], 'event.registration_confirmed')
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })

  it('waitlists an approved registration when capacity and active holds fill the event', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return {
            id: 'event-a', access_type: 'MEMBER_INCLUDED', registration_policy: 'APPROVAL',
            status: 'PUBLISHED', capacity: 2, waitlist_enabled: 1,
          }
        }
        if (sql.includes('FROM mip_event_registrations') && sql.includes('FOR UPDATE')) {
          return { id: 'registration-a', user_id: 'user-a', order_id: null, status: 'PENDING_REVIEW', version: 1 }
        }
        if (sql.includes('COUNT(*)') && sql.includes('mip_event_registrations')) return { total: 1 }
        if (sql.includes('COUNT(*)') && sql.includes('mip_event_seat_holds')) return { total: 1 }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => '00000000-0000-4000-8000-000000000002' })
    const result = await repository.reviewRegistration({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', registrationId: 'registration-a',
      expectedVersion: 1, decision: 'APPROVE', audit: status => audit({ metadata: { status } }),
    })
    assert.equal(result.status, 'WAITLISTED')
    const update = calls.find(call => call.sql.includes('UPDATE mip_event_registrations SET status = ?'))
    assert.equal(update.params[0], 'WAITLISTED')
    assert.equal(update.params[1], null)
  })

  it('rejects a pending review without issuing a ticket', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_events')) {
          return {
            id: 'event-a', access_type: 'FREE', registration_policy: 'APPROVAL',
            status: 'PUBLISHED', capacity: null, waitlist_enabled: 0,
          }
        }
        if (sql.includes('FROM mip_event_registrations')) {
          return { id: 'registration-a', user_id: 'user-a', order_id: null, status: 'PENDING_REVIEW', version: 5 }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => '00000000-0000-4000-8000-000000000003' })
    const result = await repository.reviewRegistration({
      appId: 'wx-app', actorUserId: 'admin-user', eventId: 'event-a', registrationId: 'registration-a',
      expectedVersion: 5, decision: 'REJECT', audit: status => audit({ metadata: { status } }),
    })
    assert.equal(result.status, 'REJECTED')
    assert.ok(calls.some(call => call.sql.includes("status = 'REJECTED', ticket_hash = NULL")))
  })

  it('does not allow revoking the final platform owner', async () => {
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: 'owner-a', status: 'ACTIVE' }
        return null
      },
      async query(sql) {
        if (sql.includes('FROM mip_admin_role_bindings')) return [{ id: 'binding-a' }]
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.setRole({
      appId: 'wx-app',
      actorUserId: 'owner-a',
      userId: 'owner-a',
      roleKey: 'PLATFORM_OWNER',
      active: false,
      scope: { scopeType: 'PLATFORM', scopeId: '00000000-0000-0000-0000-000000000000' },
      audit: audit({ scopeType: 'PLATFORM', scopeId: null }),
    }), /INVALID_STATE/)
  })

  it('derives a fixed-width growth source id and makes retries idempotent', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_users')) {
          return { id: 'user-a', status: 'ACTIVE', primary_branch_id: null }
        }
        if (sql.includes('FROM mip_growth_entries')) return null
        if (sql.includes('FROM mip_growth_accounts')) {
          return { experience_balance: 10, contribution_balance: 0, coin_balance: 0, version: 1 }
        }
        return null
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => 'entry-a' })
    const result = await repository.adjustGrowth({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      userId: 'user-a',
      metric: 'EXPERIENCE',
      deltaValue: 5,
      reason: '补录活动贡献',
      idempotencyKey: 'admin-growth-user-a-1724450000000',
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit: () => audit({ resourceType: 'GROWTH_ENTRY', resourceId: 'entry-a' }),
    })
    const insert = calls.find(call => call.sql.includes('INSERT INTO mip_growth_entries'))
    assert.equal(insert.params[3].length, 36)
    assert.equal(result.idempotent, false)
    const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.equal(outbox.params[4], 'growth.changed')
    assert.deepEqual(JSON.parse(outbox.params[6]), {
      userId: 'user-a', metric: 'EXPERIENCE', deltaValue: 5,
    })
  })

  it('does not deactivate or move the only active base growth level', async () => {
    for (const draft of [
      growthLevelDraft({ status: 'INACTIVE' }),
      growthLevelDraft({ minimumExperience: 50 }),
    ]) {
      const calls = []
      const repository = createAdminRepository(transactionDatabase({
        async query(sql, params) {
          calls.push({ sql, params })
          if (sql.includes('FROM mip_growth_levels')) {
            return [{ id: 'level-base', minimum_experience: 0, status: 'ACTIVE', version: 3 }]
          }
          return { affectedRows: 1 }
        },
      }))
      await assert.rejects(() => repository.saveGrowthLevel({
        appId: 'wx-app',
        actorUserId: 'admin-user',
        levelId: 'level-base',
        expectedVersion: 3,
        draft,
        audit: levelId => audit({ resourceType: 'GROWTH_LEVEL', resourceId: levelId }),
      }), error => error.code === 'GROWTH_BASE_LEVEL_REQUIRED')
      assert.equal(calls.some(call => call.sql.includes('UPDATE mip_growth_levels')), false)
      assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
    }
  })

  it('rejects duplicate active growth level thresholds before writing an audit', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_growth_levels')) {
          return [
            { id: 'level-base', minimum_experience: 0, status: 'ACTIVE', version: 1 },
            { id: 'level-next', minimum_experience: 100, status: 'ACTIVE', version: 2 },
          ]
        }
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.saveGrowthLevel({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      levelId: 'level-next',
      expectedVersion: 2,
      draft: growthLevelDraft({ levelKey: 'next', name: '进阶会员' }),
      audit: levelId => audit({ resourceType: 'GROWTH_LEVEL', resourceId: levelId }),
    }), error => error.code === 'GROWTH_LEVEL_THRESHOLD_CONFLICT')
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_growth_levels')), false)
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('saves a strictly increasing active growth level and audits only after the write', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_growth_levels')) {
          return [
            { id: 'level-base', minimum_experience: 0, status: 'ACTIVE', version: 1 },
            { id: 'level-next', minimum_experience: 100, status: 'ACTIVE', version: 2 },
          ]
        }
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.saveGrowthLevel({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      levelId: 'level-next',
      expectedVersion: 2,
      draft: growthLevelDraft({
        levelKey: 'next', name: '进阶会员', minimumExperience: 200,
      }),
      audit: levelId => audit({ resourceType: 'GROWTH_LEVEL', resourceId: levelId }),
    })
    assert.deepEqual(result, { id: 'level-next', version: 3 })
    assert.match(calls[0].sql, /FOR UPDATE/)
    const updateIndex = calls.findIndex(call => call.sql.includes('UPDATE mip_growth_levels'))
    const auditIndex = calls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(updateIndex >= 0 && auditIndex > updateIndex)
  })

  it('rejects creation of arbitrary growth rules without writing or auditing', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => 'rule-new' })
    await assert.rejects(() => repository.saveGrowthRule({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      ruleId: null,
      expectedVersion: 0,
      draft: growthRuleDraft(),
      audit: ruleId => audit({ resourceType: 'GROWTH_RULE', resourceId: ruleId }),
    }), error => error.code === 'GROWTH_RULE_NOT_CONFIGURABLE')
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_growth_rules')), false)
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('updates only values and status on an approved fixed growth rule', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_growth_rules')) {
          return [{
            id: 'rule-existing', rule_key: 'event_attended', name: '完成活动签到', metric: 'EXPERIENCE',
            source_event_type: 'event.checked_in', status: 'ACTIVE', version: 4,
          }]
        }
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.saveGrowthRule({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      ruleId: 'rule-existing',
      expectedVersion: 4,
      draft: growthRuleDraft({ deltaValue: 120, dailyLimitValue: 360 }),
      audit: ruleId => audit({ resourceType: 'GROWTH_RULE', resourceId: ruleId }),
    })
    assert.deepEqual(result, { id: 'rule-existing', version: 5 })
    const updateIndex = calls.findIndex(call => call.sql.includes('UPDATE mip_growth_rules'))
    const auditIndex = calls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(updateIndex >= 0 && auditIndex > updateIndex)
    assert.doesNotMatch(calls[updateIndex].sql, /name =|metric =|source_event_type =/)
  })

  it('rejects changes to fixed growth rule behavior without writing or auditing', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_growth_rules')) {
          return [{
            id: 'rule-existing', rule_key: 'event_attended', name: '完成活动签到',
            metric: 'EXPERIENCE', source_event_type: 'event.checked_in', status: 'ACTIVE', version: 1,
          }]
        }
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.saveGrowthRule({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      ruleId: 'rule-existing',
      expectedVersion: 1,
      draft: growthRuleDraft({ sourceEventType: 'client.claimed' }),
      audit: ruleId => audit({ resourceType: 'GROWTH_RULE', resourceId: ruleId }),
    }), error => error.code === 'GROWTH_RULE_IMMUTABLE')
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_growth_rules')), false)
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('includes event roles and event audit records for the authorized branch', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }))
    const visibility = { platform: false, branchIds: ['branch-a'], eventIds: [] }
    await repository.listRoles('wx-app', visibility)
    await repository.listAudit('wx-app', visibility, {}, 20)
    assert.match(calls[0].sql, /r\.scope_type = 'EVENT'[\s\S]*FROM mip_events e/)
    assert.equal(calls[0].params.filter(value => value === 'branch-a').length, 2)
    assert.match(calls[1].sql, /a\.scope_type = 'EVENT'[\s\S]*FROM mip_events e/)
    assert.equal(calls[1].params.filter(value => value === 'branch-a').length, 2)
  })

  it('looks up an export only by exact app, requester, ticket and token hash', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        calls.push({ sql, params })
        return null
      },
    }))
    await assert.rejects(() => repository.getExportTicket({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      ticketId: 'ticket-a',
      tokenHash: 'a'.repeat(64),
    }), /EXPORT_NOT_FOUND/)
    assert.match(calls[0].sql, /app_id = \? AND id = \? AND requested_by_user_id = \? AND token_hash = \?/)
    assert.deepEqual(calls[0].params, ['wx-app', 'ticket-a', 'admin-user', 'a'.repeat(64)])
  })

  it('commits READY metadata and the export audit in one transaction', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: 'ticket-a', app_id: 'wx-app', requested_by_user_id: 'admin-user',
          export_type: 'ORDERS', scope_type: 'PLATFORM', scope_id: null,
          filters_json: '{}', includes_phone: 0, object_key: 'mip/exports/scope/ticket-a.xlsx',
          cloud_file_id: null, content_sha256: null, content_bytes: null, row_count: null,
          status: 'PENDING', reserved_until: new Date('2026-08-24T00:01:00.000Z'),
          expires_at: new Date('2026-08-24T00:15:00.000Z'), consumed_at: null,
          failed_reason_code: null, created_at: new Date('2026-08-24T00:00:00.000Z'),
        }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const lease = new Date('2026-08-24T00:01:00.000Z')
    await repository.finishExportBuild({
      appId: 'wx-app', actorUserId: 'admin-user', ticketId: 'ticket-a', tokenHash: 'a'.repeat(64),
      reservedUntil: lease, fileId: 'cloud://test-env/mip/exports/scope/ticket-a.xlsx',
      contentSha256: 'b'.repeat(64), contentBytes: 512, rowCount: 3,
      now: new Date('2026-08-24T00:00:30.000Z'),
      audit: audit({ action: 'admin.export.prepare', resourceType: 'EXPORT_TICKET', resourceId: 'ticket-a' }),
    })
    assert.ok(calls.some(call => /status = 'PENDING' AND reserved_until = \? AND expires_at > \?/.test(call.sql)))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })
})
