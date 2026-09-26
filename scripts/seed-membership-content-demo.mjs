#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { bindAndRequireMysqlEnvironment, callCloudbase, loadCaseEnv, sqlJson, sqlLiteral } from './lib/example-cloudbase.mjs'

import { resolveOwnerPhoneHash } from './lib/mip-owner-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8'))
const content = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/demo-membership-content.json'), 'utf8'))
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const dryRun = !process.argv.includes('--apply')
const stage = String(env.MIP_DEPLOYMENT_STAGE || '')
if (stage === 'production' || !['development', 'test', 'staging'].includes(stage)
  || env.MIP_CATALOG_STAGE !== 'TEST' || env.MIP_PAYMENT_MODE === 'live') {
  throw new Error('Demo content requires a non-production TEST catalog with non-live payment')
}
if (!dryRun && (argument('confirm-env') !== env.CLOUDBASE_ENV_ID || argument('confirm-app-id') !== env.MINI_PROGRAM_APP_ID
  || !process.argv.includes('--confirm-demo-content') || (stage === 'staging' && !process.argv.includes('--confirm-staging-demo')))) {
  throw new Error('Apply requires exact environment/app confirmation, --confirm-demo-content and staging confirmation')
}
if (content.is_demo !== 1 || content.benefits.length !== 4 || content.tasks.length !== 4
  || [...content.benefits, ...content.tasks].some(item => !item.name.startsWith('演示·'))) {
  throw new Error('Demo labels and bounded catalog are required')
}
if (dryRun) {
  console.log(JSON.stringify({ valid: true, apply: false, stage, benefits: 4, tasks: 4, userAgreement: 'demo', userMutations: 0 }))
  process.exit(0)
}
bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID, { stage })
const app = sqlLiteral(env.MINI_PROGRAM_APP_ID)
const manifestKey = 'demo_membership_content_v1'
function read(sql) {
  const result = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  if (!result.success || !Array.isArray(result.data?.rows)) {
    throw new Error('Demo content readback failed')
  }
  return result.data.rows
}
function write(sql) {
  const result = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql })
  if (result.success !== true) {
    throw new Error('Demo content write was not confirmed')
  }
}
const oldManifest = read(`SELECT value_json FROM mip_app_settings WHERE app_id=${app} AND setting_key=${sqlLiteral(manifestKey)}`)[0]
const owned = oldManifest ? (typeof oldManifest.value_json === 'string' ? JSON.parse(oldManifest.value_json) : oldManifest.value_json) : null
if (owned && owned.is_demo !== 1) {
  throw new Error('Existing content manifest is not demo-owned')
}
for (const [table, items] of [['mip_growth_benefits', content.benefits], ['mip_task_cards', content.tasks]]) {
  const rows = read(`SELECT id,app_id=${app} AS same_app FROM ${table} WHERE id IN (${items.map(item => sqlLiteral(item.id)).join(',')})`)
  if (rows.some(row => !row.same_app) || (!owned && rows.length)) {
    throw new Error('Demo content ID collision; no changes applied')
  }
}
const levelIds = seed.growthLevels.map(item => item.id)
const levels = read(`SELECT id,version FROM mip_growth_levels level WHERE app_id=${app} AND id IN (${levelIds.map(sqlLiteral).join(',')})
  AND EXISTS (SELECT 1 FROM mip_app_settings manifest WHERE manifest.app_id=level.app_id
    AND manifest.setting_key LIKE 'demo_seed_manifest%' AND JSON_EXTRACT(manifest.value_json,'$.is_demo')=1
    AND JSON_SEARCH(manifest.value_json,'one',level.id) IS NOT NULL)`)
if (levels.length !== levelIds.length) {
  throw new Error('Expected demo-owned levels were not found')
}
const ownerPhoneHash = sqlLiteral(resolveOwnerPhoneHash({ appId: env.MINI_PROGRAM_APP_ID, ownerPhone: env.MIP_OWNER_PHONE, phoneEncryptionKey: env.MIP_PHONE_ENCRYPTION_KEY }))
const owners = read(`SELECT DISTINCT binding.user_id FROM mip_admin_role_bindings binding JOIN mip_users member
  ON member.app_id=binding.app_id AND member.id=binding.user_id JOIN mip_private_profiles private_profile ON private_profile.app_id=member.app_id AND private_profile.user_id=member.id WHERE binding.app_id=${app} AND private_profile.phone_hash=${ownerPhoneHash}
  AND binding.role_key='PLATFORM_OWNER' AND binding.scope_type='PLATFORM' AND binding.status='ACTIVE' AND member.status='ACTIVE'
  AND member.id NOT IN (${seed.users.map(item => sqlLiteral(item.id)).join(',')})`)
if (owners.length !== 1) {
  throw new Error('A unique existing non-demo platform owner is required as task reviewer')
}
const reviewer = sqlLiteral(owners[0].user_id)
const state = status => ({ is_demo: 1, status, version: content.version, benefitIds: content.benefits.map(item => item.id), taskIds: content.tasks.map(item => item.id), levelIds })
// Once ready, preserve administrator edits, including removed associations.
if (owned?.status !== 'READY') {
  write(`INSERT INTO mip_app_settings (app_id,setting_key,value_json) VALUES (${app},${sqlLiteral(manifestKey)},${sqlJson(state('PENDING'))})
    ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),version=version+1`)
  for (const [index, benefit] of content.benefits.entries()) {
    write(`INSERT INTO mip_growth_benefits (app_id,id,name,description,sort_order,status)
      VALUES (${app},${sqlLiteral(benefit.id)},${sqlLiteral(benefit.name)},${sqlLiteral(benefit.description)},${index + 10},'ACTIVE')
      ON DUPLICATE KEY UPDATE id=id`)
    for (const levelId of levelIds) {
      write(`INSERT INTO mip_growth_level_benefits (app_id,level_id,benefit_id,sort_order)
      VALUES (${app},${sqlLiteral(levelId)},${sqlLiteral(benefit.id)},${index + 10}) ON DUPLICATE KEY UPDATE level_id=level_id`)
    }
  }
  for (const task of content.tasks) {
    const reward = { experience: { enabled: true, amount: task.rewardExperience }, contribution: { enabled: task.rewardContribution > 0, amount: task.rewardContribution }, bonus: { enabled: false, amount: 0 } }
    const contentText = `【演示任务】${task.content}\n奖励为演示配置，提交后需管理员审核；不承诺现金奖励。管理员可在后台修改或下架。`
    write(`INSERT INTO mip_task_cards (app_id,id,name,content,purpose,completion_criteria,reward_experience,star_level,reward_config_json,
      assignment_mode,ends_at,period_start_at,period_end_at,status,created_by_user_id,assigned_owner_id,published_at,applicable_servers_json)
      VALUES (${app},${sqlLiteral(task.id)},${sqlLiteral(task.name)},${sqlLiteral(contentText)},'体验成长任务流程',
      '完成任务说明后提交，管理员核验后确认；演示验收不自动发放奖励。',${task.rewardExperience},1,${sqlJson(reward)},
      'ALL','2030-12-31 23:59:59.000','2026-09-26 00:00:00.000','2030-12-31 23:59:59.000','PUBLISHED',${reviewer},${reviewer},UTC_TIMESTAMP(3),JSON_ARRAY())
      ON DUPLICATE KEY UPDATE id=id`)
  }
  const existingAgreement = read(`SELECT value_json FROM mip_app_settings WHERE app_id=${app} AND setting_key='USER_AGREEMENT'`)
  if (!existingAgreement.length) {
    write(`INSERT INTO mip_app_settings (app_id,setting_key,value_json,updated_by_user_id)
    VALUES (${app},'USER_AGREEMENT',${sqlJson(content.userAgreement)},${reviewer})`)
  }
  for (const levelId of levelIds) {
    write(`UPDATE mip_growth_levels SET version=version+1 WHERE app_id=${app} AND id=${sqlLiteral(levelId)}`)
  }
  write(`UPDATE mip_app_settings SET value_json=${sqlJson(state('READY'))},version=version+1 WHERE app_id=${app} AND setting_key=${sqlLiteral(manifestKey)}`)
}
const summary = {
  stage,
  benefits: read(`SELECT name,status FROM mip_growth_benefits WHERE app_id=${app} AND id IN (${content.benefits.map(item => sqlLiteral(item.id)).join(',')})`),
  levelBenefits: read(`SELECT level.level_key,COUNT(benefit.id) AS active_benefits FROM mip_growth_levels level JOIN mip_growth_level_benefits relation ON relation.app_id=level.app_id AND relation.level_id=level.id JOIN mip_growth_benefits benefit ON benefit.app_id=relation.app_id AND benefit.id=relation.benefit_id WHERE level.app_id=${app} AND level.id IN (${levelIds.map(sqlLiteral).join(',')}) AND benefit.status='ACTIVE' GROUP BY level.level_key`),
  tasks: read(`SELECT name,status,reward_experience,assigned_owner_id IS NOT NULL AS requires_review,JSON_EXTRACT(reward_config_json,'$.bonus.enabled') AS bonus_enabled FROM mip_task_cards WHERE app_id=${app} AND id IN (${content.tasks.map(item => sqlLiteral(item.id)).join(',')})`),
  agreements: read(`SELECT setting_key,version,JSON_EXTRACT(value_json,'$.isDemo') AS is_demo,CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(value_json,'$.body'))) AS body_length FROM mip_app_settings WHERE app_id=${app} AND setting_key IN ('USER_AGREEMENT','MEMBERSHIP_AGREEMENT')`),
  userMutations: 0,
  issuedRewards: 0,
}
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp/demo-membership-content-readback.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary))
