'use strict'

/**
 * 「参与人数」三处展示口径一致性合同测试（用户反馈：活动卡「3头像+1参加=4」、
 * 详情「参与人数4」、公开名单只有 3 人，数字对不上）。
 *
 * 根因是展示层 count 用报名事实口径（REGISTERED/CANCELLATION_PENDING/ATTENDED，
 * 不看 share_profile），而头像预览与公开名单用公开口径（share_profile=1 +
 * REGISTERED/ATTENDED + 用户 ACTIVE + 资料存在）。隐藏资料/停用用户只被前者计数。
 *
 * 修复约束（两处都要防回退）：
 * 1. 三处展示 count（活动列表 / 活动详情 / 我的活动）与头像预览统一为公开口径，
 *    用户在三个界面数出来的数字必须一致；
 * 2. 占座与容量判断保持报名事实口径——隐藏资料者照样占名额，满员判定不因此放松。
 *
 * 结构层永远执行（SQL 谓词断言）；执行层对真实 MySQL 按仓库迁移落种子，复现
 * 「5 个报名、3 人公开」场景，断言 count == 预览头像数 == 名单总数 == 3，且满员时
 * 新报名进候补。启用方式与 sql-execution.test.js 相同：
 *   MIP_SQL_VERIFY_URI=mysql://root@127.0.0.1:3306  或  MIP_SQL_VERIFY_AUTO=1
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  createRegistration,
  getEvent,
  listEvents,
  listMyRegistrations,
  listPublicParticipants,
} = require('../domain/event-service')
const { createMysqlDatabase } = require('../lib/mysql')

const appId = 'wx-count-app'
const eventId = 'b1000000-0000-4000-8000-00000000e001'
const tokenSecret = 'participant-count-consistency-token-secret'
const profileRefSecret = 'participant-count-consistency-profile-ref-secret-0123456789'
const now = new Date('2026-08-24T00:00:00.000Z')

/** 截取 registration_count 展示子查询全文，避免断言被同语句其他谓词干扰。 */
function displayCountSubquery(sql) {
  const match = String(sql).match(/\(SELECT COUNT\(\*\) FROM mip_event_registrations rc[\s\S]*?\) AS registration_count/)
  return match ? match[0] : ''
}

function assertPublicCountCriteria(subquery) {
  assert.match(subquery, /INNER JOIN mip_users rcu ON rcu\.app_id = rc\.app_id AND rcu\.id = rc\.user_id AND rcu\.status = 'ACTIVE'/)
  assert.match(subquery, /INNER JOIN mip_profiles rcp ON rcp\.app_id = rc\.app_id AND rcp\.user_id = rc\.user_id/)
  assert.match(subquery, /rc\.share_profile = 1/)
  assert.match(subquery, /rc\.status IN \('REGISTERED','ATTENDED'\)/)
  assert.doesNotMatch(subquery, /CANCELLATION_PENDING/)
}

describe('participant display count consistency', () => {
  it('activity list card count subquery uses the public participant criteria', async () => {
    const captured = []
    const database = {
      async one() {
        return null
      },
      async query(sql) {
        captured.push(String(sql))
        return []
      },
    }
    await listEvents(database, { appId, query: { view: 'UPCOMING' }, now, tokenSecret: '' })
    const subquery = displayCountSubquery(captured.join('\n'))
    assert.ok(subquery, 'listEvents 应携带 registration_count 子查询')
    assertPublicCountCriteria(subquery)
  })

  it('event detail count subquery uses the public participant criteria', async () => {
    const captured = []
    const eventRow = {
      id: eventId,
      app_id: appId,
      scope_type: 'PLATFORM',
      organizer_user_id: 'b1000000-0000-4000-8000-00000000a001',
      title: '活动',
      summary: '摘要',
      description: '介绍',
      event_mode: 'OFFLINE',
      access_type: 'FREE',
      registration_policy: 'AUTO',
      status: 'PUBLISHED',
      starts_at: '2026-08-25T00:00:00.000Z',
      ends_at: '2026-08-25T02:00:00.000Z',
      price_cents: 0,
      currency: 'CNY',
      form_version: 1,
      registration_schema_json: '[]',
      capacity: 10,
      registration_count: 3,
    }
    const database = {
      async one(sql) {
        captured.push(String(sql))
        if (String(sql).includes('AS my_interest_count') || String(sql).includes('AS received_interest_count')) {
          return null
        }
        return eventRow
      },
      async query(sql) {
        captured.push(String(sql))
        return []
      },
    }
    await getEvent(database, {
      appId,
      eventId,
      userId: 'b1000000-0000-4000-8000-00000000a002',
      now,
      tokenSecret: '',
      profileRefSecret,
    })
    const subquery = displayCountSubquery(captured.join('\n'))
    assert.ok(subquery, 'getEvent 应携带 registration_count 子查询')
    assertPublicCountCriteria(subquery)
  })

  it('my registrations count subquery uses the public participant criteria', async () => {
    const captured = []
    const database = {
      async one(sql) {
        if (String(sql).includes('AS upcoming_count')) {
          return { upcoming_count: 0, attended_count: 0, history_count: 0 }
        }
        return null
      },
      async query(sql) {
        captured.push(String(sql))
        return []
      },
    }
    await listMyRegistrations(database, { appId, userId: 'b1000000-0000-4000-8000-00000000a002', now, tokenSecret: '' })
    const subquery = displayCountSubquery(captured.join('\n'))
    assert.ok(subquery, 'listMyRegistrations 应携带 registration_count 子查询')
    assertPublicCountCriteria(subquery)
  })

  it('avatar preview query stays aligned with the public participant list criteria', async () => {
    const captured = []
    const listDatabase = {
      async one() {
        return null
      },
      async query(sql) {
        captured.push(String(sql))
        return [{ id: eventId, registration_count: 3 }]
      },
    }
    await listEvents(listDatabase, { appId, query: { view: 'UPCOMING' }, now, tokenSecret })
    const previewSql = captured.find(sql => sql.includes('AS avatar_file_id'))
    assert.ok(previewSql, '应发起头像预览查询')
    assert.match(previewSql, /INNER JOIN mip_users ru ON ru\.app_id = r\.app_id AND ru\.id = r\.user_id AND ru\.status = 'ACTIVE'/)
    assert.match(previewSql, /JOIN mip_profiles p ON p\.app_id = r\.app_id AND p\.user_id = r\.user_id/)
    assert.match(previewSql, /r\.share_profile = 1 AND r\.status IN \('REGISTERED', 'ATTENDED'\)/)
  })

  it('seat capacity keeps counting registrations regardless of share_profile', async () => {
    const calls = []
    const event = {
      id: eventId,
      app_id: appId,
      status: 'PUBLISHED',
      title: '满员活动',
      starts_at: '2030-08-25T10:00:00.000Z',
      ends_at: '2030-08-25T12:00:00.000Z',
      registration_opens_at: null,
      registration_deadline: '2030-08-25T09:00:00.000Z',
      registration_schema_json: '[]',
      form_version: 1,
      access_type: 'FREE',
      registration_policy: 'AUTO',
      capacity: 3,
      waitlist_enabled: 1,
    }
    const tx = {
      async one(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ sql: normalized })
        if (normalized.includes('FROM mip_users')) return { id: 'b1000000-0000-4000-8000-00000000a009', status: 'ACTIVE' }
        if (normalized.includes('SELECT * FROM mip_events')) return event
        if (normalized.includes('SELECT r.*')) return null
        if (normalized.includes('COUNT(*) AS total FROM mip_event_registrations')) return { total: 3 }
        if (normalized.includes('COUNT(*) AS total FROM mip_event_seat_holds')) return { total: 0 }
        throw new Error(`unexpected read: ${normalized}`)
      },
      async query() {
        return { affectedRows: 1 }
      },
    }
    const outcome = await createRegistration({ transaction: work => work(tx) }, {
      appId,
      userId: 'b1000000-0000-4000-8000-00000000a009',
      input: {
        eventId,
        formVersion: 1,
        answers: {},
        shareProfile: true,
        idempotencyKey: 'participant-count-capacity-1',
      },
      now,
      resolveUserKind: async () => 'GUEST',
      participationAccessPolicy: { async requireAccess() { return { id: 'b1000000-0000-4000-8000-00000000a009' } } },
    })
    assert.equal(outcome.kind, 'WAITLISTED')
    const capacitySql = calls.find(call => call.sql.includes('COUNT(*) AS total FROM mip_event_registrations')).sql
    assert.doesNotMatch(capacitySql, /share_profile|mip_users|mip_profiles/,
      '占座容量统计不得引入公开资料过滤，否则隐藏资料者不再占名额')
  })
})

const realServerEnabled = Boolean(process.env.MIP_SQL_VERIFY_URI || process.env.MIP_SQL_VERIFY_AUTO === '1')

describe('participant display count consistency (real MySQL)', { skip: !realServerEnabled }, () => {
  const organizerId = 'b1000000-0000-4000-8000-00000000a001'
  const playerIdA = 'b1000000-0000-4000-8000-00000000a002'
  const playerIdB = 'b1000000-0000-4000-8000-00000000a003'
  const guestId = 'b1000000-0000-4000-8000-00000000a004'
  const hiddenId = 'b1000000-0000-4000-8000-00000000a005'
  const closedId = 'b1000000-0000-4000-8000-00000000a006'
  const newcomerId = 'b1000000-0000-4000-8000-00000000a009'
  const planId = 'b1000000-0000-4000-8000-00000000p001'
  const shared = { appId, eventId, now, tokenSecret, profileRefSecret }

  async function seedScenario(db) {
    const everyone = [organizerId, playerIdA, playerIdB, guestId, hiddenId, closedId, newcomerId]
    await db.query(`INSERT INTO mip_users (app_id, id, status, closed_at) VALUES
      ('${appId}', '${organizerId}', 'ACTIVE', NULL),
      ('${appId}', '${playerIdA}', 'ACTIVE', NULL),
      ('${appId}', '${playerIdB}', 'ACTIVE', NULL),
      ('${appId}', '${guestId}', 'ACTIVE', NULL),
      ('${appId}', '${hiddenId}', 'ACTIVE', NULL),
      ('${appId}', '${closedId}', 'CLOSED', '2030-08-21 00:00:00'),
      ('${appId}', '${newcomerId}', 'ACTIVE', NULL)`)
    await db.query(`INSERT INTO mip_event_types (id, app_id, type_key, name, status, created_by_user_id, updated_by_user_id)
      VALUES ('b1000000-0000-4000-8000-00000000t001', '${appId}', 'social', '社交', 'ACTIVE', '${organizerId}', '${organizerId}')`)
    await db.query(`INSERT INTO mip_events (
      app_id, id, scope_type, organizer_user_id, title, summary, description, event_type_key,
      event_mode, access_type, registration_policy, status, content_safety_status,
      starts_at, ends_at, venue_name, capacity, waitlist_enabled, registration_schema_json
    ) VALUES (
      '${appId}', '${eventId}', 'PLATFORM', '${organizerId}', 'MIP早会', '用户反馈场景复现', '介绍', 'social',
      'OFFLINE', 'FREE', 'AUTO', 'PUBLISHED', 'PASSED',
      '2030-09-01 08:00:00', '2030-09-01 10:00:00', '场地', 5, 1, '[]'
    )`)
    await db.query(`INSERT INTO mip_profiles (app_id, user_id, nickname, companies_json, organizations_json, visibility_json)
      VALUES ${everyone.map(id => `('${appId}', '${id}', '用户${id.slice(-4)}', '{}', '{}', '{}')`).join(', ')}`)
    // 复现用户反馈：5 个报名里 3 人公开可见（2 玩家 + 1 嘉宾），1 人未公开资料、1 人已注销。
    await db.query(`INSERT INTO mip_event_registrations (app_id, id, event_id, user_id, status, answers_json, form_version, share_profile, registered_at) VALUES
      ('${appId}', 'b1000000-0000-4000-8000-00000000r001', '${eventId}', '${playerIdA}', 'REGISTERED', '{}', 1, 1, '2030-08-20 09:00:00'),
      ('${appId}', 'b1000000-0000-4000-8000-00000000r002', '${eventId}', '${playerIdB}', 'REGISTERED', '{}', 1, 1, '2030-08-20 09:01:00'),
      ('${appId}', 'b1000000-0000-4000-8000-00000000r003', '${eventId}', '${guestId}', 'REGISTERED', '{}', 1, 1, '2030-08-20 09:02:00'),
      ('${appId}', 'b1000000-0000-4000-8000-00000000r004', '${eventId}', '${hiddenId}', 'REGISTERED', '{}', 1, 0, '2030-08-20 09:03:00'),
      ('${appId}', 'b1000000-0000-4000-8000-00000000r005', '${eventId}', '${closedId}', 'REGISTERED', '{}', 1, 1, '2030-08-20 09:04:00')`)
    // 玩家身份：有效会员权益（名单页 userKind 依据）。
    await db.query(`INSERT INTO mip_membership_plans (id, app_id, plan_key, catalog_stage, name, duration_days, price_cents, benefits_json, status)
      VALUES ('${planId}', '${appId}', 'player', 'LIVE', '玩家', 30, 100, '{}', 'ACTIVE')`)
    await db.query(`INSERT INTO mip_orders (id, app_id, user_id, order_type, membership_plan_id, merchant_order_no, idempotency_key, amount_cents, status, product_snapshot_json)
      VALUES
      ('b1000000-0000-4000-8000-00000000o001', '${appId}', '${playerIdA}', 'MEMBERSHIP', '${planId}', 'count-order-1', 'count-order-key-1', 100, 'PAID', '{}'),
      ('b1000000-0000-4000-8000-00000000o002', '${appId}', '${playerIdB}', 'MEMBERSHIP', '${planId}', 'count-order-2', 'count-order-key-2', 100, 'PAID', '{}')`)
    await db.query(`INSERT INTO mip_membership_entitlements (id, app_id, user_id, order_id, plan_id, status, starts_at, ends_at) VALUES
      ('b1000000-0000-4000-8000-00000000n001', '${appId}', '${playerIdA}', 'b1000000-0000-4000-8000-00000000o001', '${planId}', 'ACTIVE', '2020-01-01 00:00:00', '2035-01-01 00:00:00'),
      ('b1000000-0000-4000-8000-00000000n002', '${appId}', '${playerIdB}', 'b1000000-0000-4000-8000-00000000o002', '${planId}', 'ACTIVE', '2020-01-01 00:00:00', '2035-01-01 00:00:00')`)
  }

  async function applyMigrations(connectionUri) {
    const repoRoot = path.resolve(__dirname, '../../..')
    const { createRequire } = require('node:module')
    const migrations = createRequire(path.join(repoRoot, 'package.json'))('./scripts/lib/mip-migrations.mjs')
    const lock = migrations.loadMipMigrationLock(repoRoot)
    const mysql = require('mysql2/promise')
    const pool = mysql.createPool({ uri: connectionUri, connectionLimit: 2, multipleStatements: false })
    const database = createMysqlDatabase({ pool })
    try {
      for (const migration of lock.migrations) {
        const sql = fs.readFileSync(path.join(repoRoot, migration.sql), 'utf8')
        for (const statement of migrations.splitMipSqlStatements(sql)) {
          if (statement.trim()) {
            await database.query(statement)
          }
        }
      }
    }
    finally {
      await pool.end()
    }
  }

  it('list card, detail, previews and public list all report the same public count', { timeout: 300_000 }, async (t) => {
    const mysql = require('mysql2/promise')
    const server = await startVerificationServer()
    const admin = await mysql.createConnection(server.uri)
    const databaseName = `mip_count_verify_${Date.now().toString(36)}`
    try {
      await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
      const scratchUri = new URL(server.uri)
      scratchUri.pathname = `/${databaseName}`
      await applyMigrations(scratchUri.toString())
      const pool = mysql.createPool({ uri: scratchUri.toString(), connectionLimit: 4, timezone: 'Z' })
      try {
        const db = createMysqlDatabase({ pool })
        await seedScenario(db)

        // 列表卡：count == 头像数 == 3（修复前 count=5、头像=3）。
        const feed = await listEvents(db, { appId, userId: playerIdA, query: { view: 'UPCOMING' }, tokenSecret })
        const card = feed.items.find(item => item.id === eventId)
        assert.equal(card.registrationCount, 3, `活动卡参与人数应为 3，实际 ${card.registrationCount}`)
        assert.equal(card.participantPreview.length, 3, '头像预览应为 3 人')

        // 详情页「参与人数 N」与列表卡一致。
        const detail = await getEvent(db, { ...shared, userId: playerIdA })
        assert.equal(detail.registrationCount, 3)
        assert.equal(detail.participantPreview.length, 3)

        // 我的活动页「N 人参加」与详情一致。
        const mine = await listMyRegistrations(db, { appId, userId: playerIdA, tokenSecret })
        assert.equal(mine.items.find(item => item.event.id === eventId).event.registrationCount, 3)

        // 公开名单总数 == 3：玩家 tab 2 人、嘉宾 tab 1 人（用户反馈中的「2 玩家 + 1 嘉宾」）。
        const all = await listPublicParticipants(db, { ...shared, userId: playerIdA })
        assert.equal(all.items.length, 3, `公开名单应为 3 人，实际 ${all.items.length}`)
        const players = await listPublicParticipants(db, { ...shared, userId: playerIdA, query: { userKind: 'PLAYER' } })
        assert.equal(players.items.length, 2)
        const guests = await listPublicParticipants(db, { ...shared, userId: playerIdA, query: { userKind: 'GUEST' } })
        assert.equal(guests.items.length, 1)

        // 占座口径未被本次修复破坏：5 个报名（含隐藏资料与已注销）占满容量 5，
        // 新玩家只能进候补，证明隐藏资料者照样占名额。
        const outcome = await createRegistration(db, {
          appId,
          userId: newcomerId,
          input: {
            eventId,
            formVersion: 1,
            answers: {},
            shareProfile: true,
            idempotencyKey: 'participant-count-real-capacity-1',
          },
          now: new Date(),
          resolveUserKind: async () => 'GUEST',
          participationAccessPolicy: { async requireAccess() { return { id: newcomerId } } },
        })
        assert.equal(outcome.kind, 'WAITLISTED', '隐藏资料者占座未变，满员后新报名应进候补')
      }
      finally {
        await pool.end()
      }
      await admin.query(`DROP DATABASE \`${databaseName}\``)
    }
    finally {
      await admin.end().catch(() => {})
      await server.stop().catch(() => {})
    }
    t.diagnostic('participant count parity verified against real MySQL')
  })

  async function startVerificationServer() {
    if (process.env.MIP_SQL_VERIFY_URI) {
      return { uri: process.env.MIP_SQL_VERIFY_URI, stop: async () => {} }
    }
    const { createDB } = require('mysql-memory-server')
    const server = await createDB({ dbName: 'mip_count_verify', version: '8.4' })
    return {
      uri: `mysql://${server.username || 'root'}@127.0.0.1:${server.port}`,
      stop: () => server.stop(),
    }
  }
})
