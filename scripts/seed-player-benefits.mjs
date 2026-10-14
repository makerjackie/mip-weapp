#!/usr/bin/env node

// 玩家会籍设计稿数据落库：12 个等级、40 项等级权益（含等级-权益关联）、5 个会员经验值任务。
// 数据源：~/.tmp/player-benefits.html（玩家会籍参考页 2026-10-13 版）的 data / fullRules / tasks。
// 等级经验值门槛设计稿未给出，按「等级号 × 100」占位（Lv.1 = 0 起步）；任务卡点击动作未配置
// （action_type/action_target 置 NULL，与 MIW-84 未配置语义一致，玩家端整卡不可点，可在管理后台配置）。
// 原演示等级（seed-demo 的 起步/活跃/贡献者）降为 INACTIVE 并把门槛挪到 900000+，避免与 ACTIVE
// 门槛链冲突（mip_growth_levels_threshold_uk 对全部状态生效，ACTIVE 链要求唯一 0 门槛且严格递增）。
// 语句全部幂等，可安全重跑；不入审计流水（与 seed-demo 相同，属运营种子通道）。

import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlJson,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import { assertSeedSqlScope } from './lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID

const DEMO_LEVEL_IDS = [
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000003',
]
const DEMO_LEVEL_ORIGIN_THRESHOLDS = [0, 500, 1500]
const DEMO_LEVEL_RELOCATED_THRESHOLDS = [900000, 900500, 901500]
const TASK_CREATOR_USER_ID = '50000000-0000-4000-8000-000000000001'

const LEVEL_IDS = [
  '41000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000003',
  '41000000-0000-4000-8000-000000000004',
  '41000000-0000-4000-8000-000000000005',
  '41000000-0000-4000-8000-000000000006',
  '41000000-0000-4000-8000-000000000007',
  '41000000-0000-4000-8000-000000000008',
  '41000000-0000-4000-8000-000000000009',
  '41000000-0000-4000-8000-000000000010',
  '41000000-0000-4000-8000-000000000011',
  '41000000-0000-4000-8000-000000000012',
]
const BENEFIT_ID_BASE = 42000000
const TASK_IDS = [
  '43000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000002',
  '43000000-0000-4000-8000-000000000003',
  '43000000-0000-4000-8000-000000000004',
  '43000000-0000-4000-8000-000000000005',
]

// 设计稿等级梯度：[等级号, [ [权益名, 权益说明], ... ]]
const LEVEL_BENEFITS = [
  [1, [['早会/活动', '早会 / 活动报名'], ['新手任务', '新手任务链']]],
  [3, [['副本报名', '副本报名参与'], ['1星NPC', '认领 1 星 NPC']]],
  [5, [
    ['加入公会', '加入公会（1个）'],
    ['工位日卡', '基础权益兑换：工位日卡'],
    ['会议次卡', '基础权益兑换：会议室次卡'],
    ['3D打印', '基础权益兑换：3D 打印'],
    ['储物柜', '基础权益兑换：储物柜'],
    ['优先报名', '基础权益兑换：优先报名权'],
    ['勋章·破壳而出', '小勋章「破壳而出」'],
  ]],
  [8, [['2星NPC', '认领 2 星 NPC']]],
  [10, [
    ['发起拼局', '发起拼局（≤10人小型活动）'],
    ['活动场地', '进阶权益兑换：活动场地'],
    ['脑暴会', '进阶权益兑换：脑暴会'],
    ['广告位', '进阶权益兑换：广告位'],
    ['赛季通票', '进阶权益兑换：赛季通票'],
    ['勋章·小笨蛋', '勋章「小笨蛋」'],
  ]],
  [12, [['3星NPC', '认领 3 星 NPC（主持人、面访官等关键岗位）']]],
  [15, [
    ['第二公会', '加入第 2 个公会'],
    ['活动提案', '提交活动提案（笨笨团队评审）'],
    ['副会长资格', '公会副会长任职资格'],
  ]],
  [20, [
    ['悬赏任务', '发布悬赏任务'],
    ['4星NPC', '认领 4 星 NPC'],
    ['IP专访', '高价值权益兑换：IP 专访'],
    ['工位月卡', '高价值权益兑换：工位周卡、月卡'],
    ['办公室资格', '高价值权益兑换：单人办公室签约资格'],
    ['勋章·笨鸟先飞', '勋章「笨鸟先飞」'],
  ]],
  [30, [
    ['创立公会', '创立公会（发起人 / 会长资格）'],
    ['发起副本', '发起副本'],
    ['5星NPC', '认领 5 星 NPC'],
    ['投资认购', '优质项目投资份额认购资格（需风控评审）'],
    ['勋章·呆头鹅', '勋章「呆头鹅」'],
  ]],
  [40, [
    ['天使候选', '笨笨老大候选资格（可被提名）'],
    ['玩法议事', '玩法议事会参与资格（参与制定社群玩法）'],
    ['勋章·犟骨头', '勋章「犟骨头」'],
  ]],
  [50, [
    ['商城95折', '权益商城 95 折（资深玩家礼遇）'],
    ['勋章·守拙', '勋章「守拙」'],
  ]],
  [60, [
    ['大智若愚', '赛季满级荣誉「大智若愚」'],
    ['年会授勋', '年会授勋（加冕赛季「笨王」）'],
  ]],
]

const LEVELS = LEVEL_BENEFITS.map(([levelNumber], index) => ({
  id: LEVEL_IDS[index],
  key: `lv${String(levelNumber).padStart(2, '0')}`,
  name: `Lv.${levelNumber}`,
  badge: `Lv.${levelNumber}`,
  // 设计稿只给了等级号，门槛按等级号 × 100 占位（Lv.1 = 0 唯一起步门槛）。
  minimumExperience: index === 0 ? 0 : levelNumber * 100,
  sortOrder: (index + 1) * 10,
}))
const BENEFITS = LEVEL_BENEFITS.flatMap(([, items]) => items).map(([name, description], index) => ({
  id: `${BENEFIT_ID_BASE}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  description,
  sortOrder: (index + 1) * 10,
}))
// 会员经验值任务（非 NPC 任务）：[名称, 说明, 经验值]
const TASKS = [
  ['出席MIP反人性早会1次', '完成早会签到获得', 50],
  ['邀请嘉宾出席早会', '每1位嘉宾签到获得', 50],
  ['出席MIP社群活动', '参与官方/公会/副本活动，签到获得', 80],
  ['邀请玩家入会', '新玩家完成面访后发放', 100],
  ['出席MIP培训/工作坊', '参与培训/工作坊活动，签到获得', 60],
].map(([name, content, rewardExperience], index) => ({
  id: TASK_IDS[index],
  name,
  content,
  rewardExperience,
}))

function argumentValue(prefix) {
  return process.argv.slice(2).find(item => item.startsWith(`--${prefix}=`))?.slice(prefix.length + 3) || ''
}

async function query(sql) {
  const response = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  return response?.data?.rows ?? []
}

async function runStatement(sql) {
  const result = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql }, 300000)
  if (result?.success === false) {
    throw new Error(`management API reported failure: ${sql.slice(0, 120)}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`MIP player-benefits seed preflight failed: ${label} (expected ${expected}, got ${actual})`)
  }
}

function buildStatements(appId) {
  const statements = []
  for (const [index, levelId] of DEMO_LEVEL_IDS.entries()) {
    statements.push(
      `UPDATE mip_growth_levels SET status = 'INACTIVE', minimum_experience = ${DEMO_LEVEL_RELOCATED_THRESHOLDS[index]},
        version = version + 1 WHERE app_id = ${sqlLiteral(appId)} AND id = ${sqlLiteral(levelId)}
        AND status = 'ACTIVE' AND minimum_experience = ${DEMO_LEVEL_ORIGIN_THRESHOLDS[index]}`,
    )
  }
  for (const benefit of BENEFITS) {
    statements.push(
      `INSERT INTO mip_growth_benefits (id, app_id, name, description, sort_order, status)
       VALUES (${sqlLiteral(benefit.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(benefit.name)},
        ${sqlLiteral(benefit.description)}, ${benefit.sortOrder}, 'ACTIVE')
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
        sort_order = VALUES(sort_order), status = 'ACTIVE', version = version + 1`,
    )
  }
  for (const [index, level] of LEVELS.entries()) {
    const benefitNames = LEVEL_BENEFITS[index][1].map(([name]) => name)
    statements.push(
      `INSERT INTO mip_growth_levels (id, app_id, level_key, name, display_badge, minimum_experience,
        sort_order, benefits_json, status)
       VALUES (${sqlLiteral(level.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(level.key)}, ${sqlLiteral(level.name)},
        ${sqlLiteral(level.badge)}, ${level.minimumExperience}, ${level.sortOrder},
        ${sqlJson(benefitNames)}, 'ACTIVE')
       ON DUPLICATE KEY UPDATE name = VALUES(name), display_badge = VALUES(display_badge),
        minimum_experience = VALUES(minimum_experience), sort_order = VALUES(sort_order),
        benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`,
    )
  }
  statements.push(
    `DELETE FROM mip_growth_level_benefits WHERE app_id = ${sqlLiteral(appId)}
      AND level_id IN (${LEVELS.map(level => sqlLiteral(level.id)).join(', ')})`,
  )
  // BENEFITS 由 LEVEL_BENEFITS 按顺序展开，游标推进即可对齐每级的权益区间。
  let benefitCursor = 0
  for (const [index, level] of LEVELS.entries()) {
    for (let benefitIndex = 0; benefitIndex < LEVEL_BENEFITS[index][1].length; benefitIndex += 1) {
      statements.push(
        `INSERT INTO mip_growth_level_benefits (app_id, level_id, benefit_id, sort_order)
         VALUES (${sqlLiteral(appId)}, ${sqlLiteral(level.id)}, ${sqlLiteral(BENEFITS[benefitCursor].id)}, ${benefitIndex})`,
      )
      benefitCursor += 1
    }
  }
  for (const task of TASKS) {
    statements.push(
      `INSERT INTO mip_task_cards (id, app_id, name, content, reward_experience, star_level,
        attachment_required, assignment_mode, status, created_by_user_id, published_at)
       VALUES (${sqlLiteral(task.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(task.name)}, ${sqlLiteral(task.content)},
        ${task.rewardExperience}, 0, 0, 'ALL', 'PUBLISHED', ${sqlLiteral(TASK_CREATOR_USER_ID)}, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE name = VALUES(name), content = VALUES(content),
        reward_experience = VALUES(reward_experience), status = 'PUBLISHED',
        published_at = COALESCE(published_at, UTC_TIMESTAMP(3)), version = version + 1`,
    )
  }
  return statements
}

async function main() {
  const validateOnly = process.argv.includes('--validate-only')
  const confirmedEnv = argumentValue('confirm-env')
  const confirmedApp = argumentValue('confirm-app')
  if (!envId || confirmedEnv !== envId) {
    throw new Error('MIP player-benefits seed requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
  }
  bindAndRequireMysqlEnvironment(root, envId)

  const appRows = await query(
    `SELECT DISTINCT app_id FROM mip_growth_levels`,
  )
  assertEqual(appRows.length, 1, 'growth levels must belong to exactly one AppID')
  const appId = appRows[0].app_id
  if (confirmedApp !== appId) {
    throw new Error(`MIP player-benefits seed requires --confirm-app=${appId}`)
  }

  // 演示等级要么仍在原位（待本脚本挪走），要么已被上一次执行挪到目标门槛。
  const demoRows = await query(
    `SELECT id, minimum_experience, status FROM mip_growth_levels WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${DEMO_LEVEL_IDS.map(sqlLiteral).join(', ')})`,
  )
  assertEqual(demoRows.length, 3, 'the three seed-demo levels must exist')
  for (const [index, levelId] of DEMO_LEVEL_IDS.entries()) {
    const row = demoRows.find(item => item.id === levelId)
    const atOrigin = row.status === 'ACTIVE' && Number(row.minimum_experience) === DEMO_LEVEL_ORIGIN_THRESHOLDS[index]
    const relocated = row.status === 'INACTIVE' && Number(row.minimum_experience) === DEMO_LEVEL_RELOCATED_THRESHOLDS[index]
    if (!atOrigin && !relocated) {
      throw new Error(`MIP player-benefits seed preflight failed: demo level ${levelId} is in an unexpected state`)
    }
  }

  const conflictRows = await query(
    `SELECT id, minimum_experience FROM mip_growth_levels WHERE app_id = ${sqlLiteral(appId)}
      AND minimum_experience IN (${LEVELS.map(level => level.minimumExperience).join(', ')})
      AND id NOT IN (${LEVELS.map(level => sqlLiteral(level.id)).join(', ')})
      AND id NOT IN (${DEMO_LEVEL_IDS.map(sqlLiteral).join(', ')})`,
  )
  assertEqual(conflictRows.length, 0, 'target thresholds must not be taken by other levels')

  const benefitNameRows = await query(
    `SELECT id FROM mip_growth_benefits WHERE app_id = ${sqlLiteral(appId)}
      AND name IN (${BENEFITS.map(benefit => sqlLiteral(benefit.name)).join(', ')})
      AND id NOT IN (${BENEFITS.map(benefit => sqlLiteral(benefit.id)).join(', ')})`,
  )
  assertEqual(benefitNameRows.length, 0, 'benefit names must not be taken by other benefits')

  const taskNameRows = await query(
    `SELECT id FROM mip_task_cards WHERE app_id = ${sqlLiteral(appId)}
      AND name IN (${TASKS.map(task => sqlLiteral(task.name)).join(', ')})
      AND id NOT IN (${TASK_IDS.map(sqlLiteral).join(', ')})`,
  )
  assertEqual(taskNameRows.length, 0, 'task names must not be taken by other task cards')

  const deletedTaskRows = await query(
    `SELECT id FROM mip_task_cards WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${TASK_IDS.map(sqlLiteral).join(', ')}) AND status = 'DELETED'`,
  )
  assertEqual(deletedTaskRows.length, 0, 'seed task IDs must not be in DELETED state')

  const creatorRows = await query(
    `SELECT id FROM mip_users WHERE id = ${sqlLiteral(TASK_CREATOR_USER_ID)}`,
  )
  assertEqual(creatorRows.length, 1, 'task creator user must exist')

  const statements = buildStatements(appId)
  const scope = assertSeedSqlScope(statements)
  console.log(`[player-benefits] app=${appId} statements=${scope.statementCount} tables=${scope.tables.join(', ')}`)
  if (validateOnly) {
    console.log('[player-benefits] validate-only: preflight passed, no writes executed')
    return
  }
  for (const [index, sql] of statements.entries()) {
    await runStatement(sql)
    if ((index + 1) % 10 === 0) {
      console.log(`[player-benefits] ${index + 1}/${statements.length} statements applied`)
    }
  }

  const levelRows = await query(
    `SELECT id, level_key, name, minimum_experience, status FROM mip_growth_levels
      WHERE app_id = ${sqlLiteral(appId)} ORDER BY minimum_experience`,
  )
  const activeLevels = levelRows.filter(row => row.status === 'ACTIVE')
  assertEqual(activeLevels.length, LEVELS.length, 'exactly the 12 seeded levels stay ACTIVE')
  assertEqual(Number(activeLevels[0].minimum_experience), 0, 'the lowest ACTIVE threshold must be 0')
  for (let index = 1; index < activeLevels.length; index += 1) {
    if (Number(activeLevels[index].minimum_experience) <= Number(activeLevels[index - 1].minimum_experience)) {
      throw new Error('MIP player-benefits seed verification failed: ACTIVE thresholds are not strictly increasing')
    }
  }
  const benefitRows = await query(
    `SELECT COUNT(*) AS n FROM mip_growth_benefits WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${BENEFITS.map(benefit => sqlLiteral(benefit.id)).join(', ')}) AND status = 'ACTIVE'`,
  )
  assertEqual(Number(benefitRows[0].n), BENEFITS.length, 'all 40 benefits must be ACTIVE')
  const relationRows = await query(
    `SELECT COUNT(*) AS n FROM mip_growth_level_benefits WHERE app_id = ${sqlLiteral(appId)}
      AND level_id IN (${LEVELS.map(level => sqlLiteral(level.id)).join(', ')})`,
  )
  assertEqual(Number(relationRows[0].n), BENEFITS.length, 'all 40 level-benefit relations must exist')
  const taskRows = await query(
    `SELECT name, reward_experience, status FROM mip_task_cards WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${TASK_IDS.map(sqlLiteral).join(', ')})`,
  )
  assertEqual(taskRows.length, TASKS.length, 'all 5 member tasks must exist')
  for (const task of TASKS) {
    const row = taskRows.find(item => item.name === task.name)
    if (!row || row.status !== 'PUBLISHED' || Number(row.reward_experience) !== task.rewardExperience) {
      throw new Error(`MIP player-benefits seed verification failed for task: ${task.name}`)
    }
  }
  console.log(`[player-benefits] verified: ${activeLevels.length} ACTIVE levels (${activeLevels.map(row => row.name).join(', ')}), ${BENEFITS.length} benefits, ${BENEFITS.length} relations, ${TASKS.length} PUBLISHED tasks`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
