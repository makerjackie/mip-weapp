'use strict'

/**
 * MIW-36：云函数 SQL 真实执行验证。MIW-28 的 MySQL 1064（拉黑片段裸 NOT EXISTS 拼进
 * JOIN ON 缺 AND）当时测试全绿、靠人工评审才发现——既有测试用 stub 池只做文本正则
 * 断言，「SQL 合法性 / 占位符顺序对真实服务器」这一故障类别没有覆盖。
 *
 * 本文件两层防线，覆盖 getEvent / getHeart / listHeartCandidates / heartCounts 产出的
 * 全部语句：
 *
 * 1. 结构层（始终执行）：录制四类函数发出的每一条语句，逐条做 MySQL 方言解析
 *    （node-sql-parser）+ mysql2 占位符语义的 ? 计数与 params 长度一致性 + 心动
 *    sent/received 片段同源断言（详情计数、tab 列表、selected 不可能各自漂移）。
 * 2. 执行层（需真实服务器，可选）：对真实 MySQL 应用仓库全量迁移并落种子数据，把四类
 *    函数端到端跑一遍，断言详情计数 == tab 计数 == 列表长度。默认跳过；启用方式：
 *    - MIP_SQL_VERIFY_URI=mysql://root@127.0.0.1:3306  指向任意 MySQL 8.0.16+ 实例
 *      （仓库迁移使用 DROP CHECK 语法，8.0.15 及更早不支持），例如：
 *      docker run -d -p 3306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=1 mysql:8.4
 *    - MIP_SQL_VERIFY_AUTO=1  用 mysql-memory-server 自备一次性实例（首次需联网下载）。
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { Parser } = require('node-sql-parser')
const {
  getEvent,
  getHeart,
  heartCounts,
  heartVisibilityFilters,
  listHeartCandidates,
} = require('../domain/event-service')
const { createMysqlDatabase } = require('../lib/mysql')

const appId = 'wx-app'
const eventId = 'a0000000-0000-4000-8000-00000000e001'
// profileRef 构造要求 userId 为标准 UUID（[1-5] 版本位 + [89ab] variant 位），全十六进制。
const viewerId = 'a0000000-0000-4000-8000-000000000001'
const targetId = 'a0000000-0000-4000-8000-000000000002'
const voterId = 'a0000000-0000-4000-8000-000000000003'
const blockedId = 'a0000000-0000-4000-8000-000000000004'
const departedId = 'a0000000-0000-4000-8000-000000000005'
const quietId = 'a0000000-0000-4000-8000-000000000006'
const organizerId = 'a0000000-0000-4000-8000-000000000009'
const tokenSecret = 'sql-execution-token-secret'
const profileRefSecret = 'sql-execution-profile-ref-secret-0123456789abcdef'
const shared = { appId, eventId, tokenSecret, profileRefSecret }

const parser = new Parser()

/** mysql2 占位符语义：`?` 与 `??` 各消费一个参数，引号内不计数。 */
function countPlaceholders(sql) {
  let count = 0
  let quote = null
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    if (quote) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '?') {
      count += 1
      if (sql[index + 1] === '?') {
        index += 1
      }
    }
  }
  return count
}

/** 按语句形状路由结果的录制池：让四类函数把各自全部语句真实发出来。 */
function recordingDatabase() {
  const captured = []
  const route = (sql) => {
    if (sql.includes('AS my_interest_count')) {
      return { my_interest_count: 1 }
    }
    if (sql.includes('AS received_interest_count')) {
      return { received_interest_count: 2 }
    }
    if (sql.includes('SELECT id, event_id, user_id')) {
      return { id: 'registration-self', event_id: eventId, user_id: viewerId, status: 'ATTENDED', version: 3 }
    }
    if (sql.includes('LEFT JOIN mip_event_registrations tr')) {
      return {
        version: 4,
        updated_at: '2026-08-24T00:00:00.000Z',
        registration_id: 'registration-target',
        user_id: targetId,
        nickname: '我的心动目标',
        headline: '简介',
      }
    }
    if (sql.includes('FROM mip_events e')) {
      return {
        id: eventId,
        app_id: appId,
        scope_type: 'PLATFORM',
        organizer_user_id: organizerId,
        title: '活动',
        summary: '摘要',
        description: '介绍',
        notices: null,
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
        // cancellation_deadline 留空：effectiveCancellationDeadline 的 mip_app_settings 回退查询才会发出。
        registration_status: 'ATTENDED',
        registration_version: 3,
        registration_count: 5,
      }
    }
    return null
  }
  return {
    captured,
    async query(sql, params = []) {
      captured.push({ sql, params })
      if (/ORDER BY r\.registered_at DESC/.test(sql)) {
        return [
          { registration_id: 'registration-target', user_id: targetId, nickname: '我的心动目标' },
          { registration_id: 'registration-voter', user_id: voterId, nickname: '对我心动的投票者' },
          { registration_id: 'registration-blocked', user_id: blockedId, nickname: '已拉黑' },
        ]
      }
      return []
    },
    async one(sql, params = []) {
      captured.push({ sql, params })
      return route(sql)
    },
    async transaction(work) {
      return work(this)
    },
  }
}

async function captureFunctionStatements() {
  const database = recordingDatabase()
  const now = new Date('2026-08-24T00:00:00.000Z')
  // 已签到查看者：详情（含互动计数）、心动、候选全覆盖；再看一次游客详情（无拉黑参数的变体）。
  await getEvent(database, { ...shared, userId: viewerId, now })
  await getHeart(database, { ...shared, userId: viewerId })
  await listHeartCandidates(database, { ...shared, userId: viewerId })
  await heartCounts(database, { appId, eventId, userId: viewerId })
  await getEvent(database, { ...shared, userId: null, now })
  return database.captured
}

const collapse = sql => sql.replace(/\s+/g, ' ').trim()

test('sent/received visibility fragments are structural mirrors from one constructor', () => {
  const visibility = heartVisibilityFilters(viewerId)
  // 同一构造的两个方向：除方向名（tr/vr）与互补列（target/voter）外必须逐字一致——
  // 任何一侧被单独改动（例如只给一边加状态谓词）都会在这里暴露。
  assert.equal(
    collapse(visibility.received.counterpartJoin
      .replace(/\bvr\b/g, 'tr')
      .replace('tr.user_id = h.voter_user_id', 'tr.user_id = h.target_user_id')),
    collapse(visibility.sent.counterpartJoin),
  )
  assert.equal(
    visibility.received.predicate.replace('h.target_user_id', 'h.voter_user_id'),
    collapse(visibility.sent.predicate),
  )
  // 拉黑过滤对两个方向产出同构片段且 viewer 参数各成对。
  const sentBlock = visibility.sent.block
  const receivedBlock = visibility.received.block
  assert.equal(countPlaceholders(sentBlock.sql), sentBlock.params.length)
  assert.equal(countPlaceholders(receivedBlock.sql), receivedBlock.params.length)
  assert.deepEqual(sentBlock.params, [viewerId, viewerId])
  assert.deepEqual(receivedBlock.params, [viewerId, viewerId])
})

test('every statement from detail/heart/candidates/counts parses as MySQL with matching placeholders', async () => {
  const captured = await captureFunctionStatements()
  assert.ok(captured.length >= 14, `四类函数应产出完整语句集，实际 ${captured.length} 条`)

  const sqlTexts = captured.map(statement => statement.sql)
  const requiredFamilies = [
    ['detail 主查询', /FROM mip_events e\b/],
    ['参与人预览', /share_profile = 1/],
    ['活动变更', /FROM mip_event_changes/],
    ['详情内容媒体', /FROM mip_event_content_media/],
    ['公开标签（窗口函数）', /ROW_NUMBER\(\) OVER/],
    ['公开视频回顾', /public_recap/],
    ['取消截止设置回退', /FROM mip_app_settings/],
    ['签到资格检查', /SELECT id, event_id, user_id/],
    ['心动 target 行', /LEFT JOIN mip_event_registrations tr/],
    ['对我心动列表', /AND h\.target_user_id = \? AND h\.status = 'ACTIVE'/],
    ['候选列表', /r\.status = 'ATTENDED' AND r\.user_id <> \?/],
    ['selected 查询', /SELECT tr\.id AS registration_id/],
    ['我的心动计数', /AS my_interest_count/],
    ['对我心动计数', /AS received_interest_count/],
  ]
  for (const [label, pattern] of requiredFamilies) {
    assert.ok(sqlTexts.some(sql => pattern.test(sql)), `语句族缺失：${label}`)
  }

  const seen = new Set()
  for (const { sql, params } of captured) {
    const key = collapse(sql)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    // 1064 类故障（例如裸 NOT EXISTS 拼进 JOIN ON）在这里被 MySQL 方言解析拦截。
    assert.doesNotThrow(() => parser.astify(sql, { database: 'mysql' }), `SQL 语法非法：${key}`)
    assert.equal(countPlaceholders(sql), params.length, `占位符数量与参数不一致：${key}`)
    assert.equal(params.includes(undefined), false, `参数含 undefined（lib/mysql.js 会拒绝）：${key}`)
  }
  assert.ok(seen.size >= 14, `去重语句应覆盖全部语句族，实际 ${seen.size} 条`)
})

test('heart counts and lists embed identical visibility fragment text', async () => {
  const captured = await captureFunctionStatements()
  const visibility = heartVisibilityFilters(viewerId)
  const byFamily = pattern => captured.filter(({ sql }) => pattern.test(sql))

  const embeds = (statement, fragment) => collapse(statement.sql).includes(collapse(fragment))
  // sent：计数与 selected 必须携带同一 JOIN/谓词/拉黑片段——否则详情胶囊与候选选中态分叉。
  for (const statement of [
    ...byFamily(/AS my_interest_count/),
    ...byFamily(/SELECT tr\.id AS registration_id/),
  ]) {
    assert.ok(embeds(statement, visibility.sent.counterpartJoin),
      `sent 计数/selected 未消费共享 JOIN 片段：${collapse(statement.sql)}`)
    assert.ok(embeds(statement, visibility.sent.predicate), 'sent 计数/selected 未消费共享谓词')
    assert.ok(embeds(statement, visibility.sent.block.sql), 'sent 计数/selected 缺少拉黑过滤（口径降级）')
  }
  // received：列表与计数必须同人群（同一 JOIN + 谓词 + 拉黑片段），否则详情与 tab 徽标分叉。
  for (const statement of [
    ...byFamily(/AS received_interest_count/),
    ...byFamily(/AND h\.target_user_id = \? AND h\.status = 'ACTIVE'/),
  ]) {
    assert.ok(embeds(statement, visibility.received.counterpartJoin), 'received 未消费共享 JOIN 片段')
    assert.ok(embeds(statement, visibility.received.profileJoin), 'received 缺少资料 JOIN（口径降级）')
    assert.ok(embeds(statement, visibility.received.predicate), 'received 未消费共享谓词')
    assert.ok(embeds(statement, visibility.received.block.sql), 'received 缺少拉黑过滤（口径降级）')
  }
})

const realServerEnabled = Boolean(process.env.MIP_SQL_VERIFY_URI || process.env.MIP_SQL_VERIFY_AUTO === '1')

test('statements execute against a real MySQL server with schema and seed data', { timeout: 300_000 }, async (t) => {
  if (!realServerEnabled) {
    t.skip('设置 MIP_SQL_VERIFY_URI 或 MIP_SQL_VERIFY_AUTO=1 启用真实 MySQL 执行验证')
    return
  }
  const mysql = require('mysql2/promise')
  const server = await startVerificationServer()
  const databaseName = `mip_sql_verify_${Date.now().toString(36)}`
  const admin = await mysql.createConnection(server.uri)
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    const scratchUri = new URL(server.uri)
    scratchUri.pathname = `/${databaseName}`
    await applyMigrations(scratchUri.toString())
    // 显式建池以便收尾 pool.end()：适配器不暴露 close，泄漏的池会拖住进程退出。
    const pool = mysql.createPool({ uri: scratchUri.toString(), connectionLimit: 4, timezone: 'Z' })
    try {
      const db = createMysqlDatabase({ pool })
      await seedScenario(db)
      await assertRealExecutionParity(db)
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
})

async function startVerificationServer() {
  if (process.env.MIP_SQL_VERIFY_URI) {
    return { uri: process.env.MIP_SQL_VERIFY_URI, stop: async () => {} }
  }
  const { createDB } = require('mysql-memory-server')
  const server = await createDB({ dbName: 'mip_sql_verify', version: '8.4' })
  return {
    uri: `mysql://${server.username || 'root'}@127.0.0.1:${server.port}`,
    stop: () => server.stop(),
  }
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

/**
 * 种子场景（真实 MySQL）：
 * - viewer 已签到；viewer → target 一条 ACTIVE 心动；
 * - voter（ATTENDED）与 departed（报名 CANCELLED 但报名行仍在）各有一条指向 viewer 的
 *   ACTIVE 心动——现口径 received 按「报名行存在 + 资料存在」计，不限定报名状态，
 *   departed 必须计入（heartVisibilityFilters 文档注释）；
 * - viewer 拉黑了 blocked：blocked → viewer 的心动与候选卡双向过滤。
 */
async function seedScenario(db) {
  const users = [organizerId, viewerId, targetId, voterId, blockedId, departedId, quietId]
  const registrationOf = {
    [viewerId]: 'a0000000-0000-4000-8000-00000000r001',
    [targetId]: 'a0000000-0000-4000-8000-00000000r002',
    [voterId]: 'a0000000-0000-4000-8000-00000000r003',
    [blockedId]: 'a0000000-0000-4000-8000-00000000r004',
    [departedId]: 'a0000000-0000-4000-8000-00000000r005',
    [quietId]: 'a0000000-0000-4000-8000-00000000r006',
  }
  await db.query(`INSERT INTO mip_users (app_id, id) VALUES ${users.map(id => `('${appId}', '${id}')`).join(', ')}`)
  // mip_events.event_type_key → mip_event_types(app_id, type_key)，先落类型目录。
  await db.query(`INSERT INTO mip_event_types (id, app_id, type_key, name, status, created_by_user_id, updated_by_user_id)
    VALUES ('a0000000-0000-4000-8000-00000000t001', '${appId}', 'social', '社交', 'ACTIVE', '${organizerId}', '${organizerId}')`)
  await db.query(`INSERT INTO mip_events (
    app_id, id, scope_type, organizer_user_id, title, summary, description, event_type_key,
    event_mode, access_type, registration_policy, status, content_safety_status,
    starts_at, ends_at, venue_name, capacity, registration_schema_json
  ) VALUES (
    '${appId}', '${eventId}', 'PLATFORM', '${organizerId}', '心动计数验证活动', '摘要', '介绍', 'social',
    'OFFLINE', 'FREE', 'AUTO', 'PUBLISHED', 'PASSED',
    '2026-08-25 10:00:00', '2026-08-25 12:00:00', '场地', 30, '[]'
  )`)
  await db.query(`INSERT INTO mip_profiles (app_id, user_id, nickname, companies_json, organizations_json, visibility_json)
    VALUES ${users.map(id => `('${appId}', '${id}', '用户${id.slice(-4)}', '{}', '{}', '{}')`).join(', ')}`)
  await db.query(`INSERT INTO mip_event_registrations (app_id, id, event_id, user_id, status, answers_json, form_version, share_profile, registered_at) VALUES ${
    users.filter(id => registrationOf[id])
      .map(id => `('${appId}', '${registrationOf[id]}', '${eventId}', '${id}', '${id === departedId ? 'CANCELLED' : 'ATTENDED'}', '{}', 1, 1, '2026-08-20 09:00:00')`)
      .join(', ')
  }`)
  await db.query(`INSERT INTO mip_event_hearts (app_id, id, event_id, voter_user_id, target_user_id, status) VALUES
    ('${appId}', 'a0000000-0000-4000-8000-00000000h001', '${eventId}', '${viewerId}', '${targetId}', 'ACTIVE'),
    ('${appId}', 'a0000000-0000-4000-8000-00000000h002', '${eventId}', '${voterId}', '${viewerId}', 'ACTIVE'),
    ('${appId}', 'a0000000-0000-4000-8000-00000000h003', '${eventId}', '${blockedId}', '${viewerId}', 'ACTIVE'),
    ('${appId}', 'a0000000-0000-4000-8000-00000000h004', '${eventId}', '${departedId}', '${viewerId}', 'ACTIVE')`)
  await db.query(`INSERT INTO mip_user_blocks (app_id, blocker_user_id, blocked_user_id, status)
    VALUES ('${appId}', '${viewerId}', '${blockedId}', 'ACTIVE')`)
}

async function assertRealExecutionParity(db) {
  const now = new Date('2026-08-24T00:00:00.000Z')
  const [detail, heart, candidates] = await Promise.all([
    getEvent(db, { ...shared, userId: viewerId, now }),
    getHeart(db, { ...shared, userId: viewerId }),
    listHeartCandidates(db, { ...shared, userId: viewerId }),
  ])
  const counts = await heartCounts(db, { appId, eventId, userId: viewerId })

  // 详情胶囊 == heartCounts == getHeart.counts（同一 helper 的三个消费面）。
  assert.deepEqual(detail.interactionSummary, counts)
  assert.deepEqual(heart.counts, counts)
  assert.deepEqual(counts, { myInterestCount: 1, receivedInterestCount: 2 })

  // 三口径一致：详情计数 == tab 徽标（页面渲染 heart.counts）== 列表长度。
  assert.equal(counts.myInterestCount, heart.target ? 1 : 0)
  assert.equal(counts.receivedInterestCount, heart.received.length)

  // 候选列表：已离开/拉黑者被过滤，被选目标带 selected 且与 heart.target 同一人。
  // （profileRef 每次构造用随机 IV 加密，同人两次产出也不同串，身份对比用种子内唯一昵称。）
  assert.equal(candidates.length, 3, '候选应只有 target/voter/quiet（cancelled 报名与拉黑者被过滤）')
  const selectedCandidates = candidates.filter(candidate => candidate.selected)
  assert.equal(selectedCandidates.length, 1)
  assert.equal(selectedCandidates[0].nickname, heart.target?.nickname)

  // 已签到 0/0 也照常下发（MIW-28 口径：胶囊常驻，不因 0 隐藏）：quiet 已签到但无任何心动。
  const quietDetail = await getEvent(db, { ...shared, userId: quietId, now })
  assert.deepEqual(quietDetail.interactionSummary, { myInterestCount: 0, receivedInterestCount: 0 })
  assert.equal(quietDetail.canInteract, true)

  // 交叉视角的计数按同一口径计算：voter 发出 1（→viewer）、收到 0。
  const voterDetail = await getEvent(db, { ...shared, userId: voterId, now })
  assert.deepEqual(voterDetail.interactionSummary, { myInterestCount: 1, receivedInterestCount: 0 })

  // 未签到查看者不下发 interactionSummary（客户端整卡隐藏）。
  const departedDetail = await getEvent(db, { ...shared, userId: departedId, now })
  assert.equal('interactionSummary' in departedDetail, false)
  assert.equal(departedDetail.canInteract, false)

  // 拉黑双向过滤：D 视角下自己发给 viewer 的心动不可见（viewer 已拉黑 D）。
  const blockedHeart = await getHeart(db, { ...shared, userId: blockedId })
  assert.equal(blockedHeart.target, undefined)
  assert.equal(blockedHeart.received.length, 0)
}
