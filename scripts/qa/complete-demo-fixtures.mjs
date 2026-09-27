/** Explicitly synthetic QA facts. Never used by application or cloud functions. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { bindAndRequireMysqlEnvironment, callCloudbase, loadCaseEnv, sqlLiteral } from '../lib/example-cloudbase.mjs'
import { requireTestEnvironment } from './demo-role-policy.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const env = loadCaseEnv(root)
requireTestEnvironment(env)
assert(process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`), 'Exact environment confirmation required')
assert(env.MIP_DEPLOYMENT_STAGE !== 'staging' || process.argv.includes('--confirm-staging-demo'), 'Staging demo confirmation required')
assert(process.argv.includes('--apply') || process.argv.includes('--cleanup'), 'Choose apply or cleanup')
bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID, { stage: env.MIP_DEPLOYMENT_STAGE })
const q = sqlLiteral
const a = q(env.MINI_PROGRAM_APP_ID)
const user = n => `50000000-0000-4000-8000-00000000000${n}`
const ids = { visit: 'fa927000-0000-4000-8000-000000000001', playerVisit: 'fa927000-0000-4000-8000-000000000002', opportunity: 'fa927000-0000-4000-8000-000000000003', registration: 'fa927000-0000-4000-8000-000000000004', checkin: 'fa927000-0000-4000-8000-000000000005' }
const event = '60000000-0000-4000-8000-000000000003'
const marker = 'qa-completion-20260927'
function read(sql) {
  const r = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  assert.equal(r.success, true)
  assert(Array.isArray(r.data?.rows))
  return r.data.rows
}
function write(sql) {
  assert(sql.includes(a), 'App scope required')
  const r = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql })
  assert.notEqual(r.success, false)
}
const manifest = read(`SELECT value_json FROM mip_app_settings WHERE app_id=${a} AND setting_key='demo_seed_manifest'`)[0]
const seed = typeof manifest?.value_json === 'string' ? JSON.parse(manifest.value_json) : manifest?.value_json
assert(seed?.is_demo === 1 && seed?.state === 'READY', 'Existing ready demo manifest required')
const users = read(`SELECT id FROM mip_users WHERE app_id=${a} AND id IN (${[1, 2, 3, 4, 5, 6].map(n => q(user(n))).join(',')}) AND status='ACTIVE'`)
assert.equal(users.length, 6, 'Requires all six existing demo actors')
const definitions = [
  { table: 'mip_profile_interests', id: 'fa927000-0000-4000-8000-000000000006', predicate: `actor_user_id=${q(user(4))} AND target_user_id=${q(user(2))} AND source_type='COOPERATION_CARD' AND source_id='63000000-0000-4000-8000-000000000002'`, columns: 'id,app_id,actor_user_id,target_user_id,source_type,source_id', values: `'fa927000-0000-4000-8000-000000000006',${a},${q(user(4))},${q(user(2))},'COOPERATION_CARD','63000000-0000-4000-8000-000000000002'` },
  { table: 'mip_profile_visits', id: ids.visit, predicate: `visitor_user_id=${q(user(4))} AND profile_user_id=${q(user(3))} AND visit_key=${q(marker)}`, columns: 'id,app_id,visitor_user_id,profile_user_id,visit_key', values: `${q(ids.visit)},${a},${q(user(4))},${q(user(3))},${q(marker)}` },
  { table: 'mip_profile_visits', id: ids.playerVisit, predicate: `visitor_user_id=${q(user(4))} AND profile_user_id=${q(user(1))} AND visit_key=${q(marker)}`, columns: 'id,app_id,visitor_user_id,profile_user_id,visit_key', values: `${q(ids.playerVisit)},${a},${q(user(4))},${q(user(1))},${q(marker)}` },
  { table: 'mip_opportunities', id: ids.opportunity, predicate: `owner_user_id=${q(user(1))} AND title='[DEMO QA] 暂时下架的合作机会'`, columns: 'id,app_id,owner_user_id,title,value_summary,target_summary,description,status,content_safety_status,published_at', values: `${q(ids.opportunity)},${a},${q(user(1))},'[DEMO QA] 暂时下架的合作机会','演示验收专用，可清理','演示合作伙伴',${q(marker)},'UNPUBLISHED','APPROVED',UTC_TIMESTAMP(3)` },
  { table: 'mip_event_registrations', id: ids.registration, predicate: `event_id=${q(event)} AND user_id=${q(user(6))} AND JSON_UNQUOTE(JSON_EXTRACT(answers_json,'$.qaFixture'))=${q(marker)}`, columns: 'id,app_id,event_id,user_id,status,answers_json,form_version,share_profile,registered_at', values: `${q(ids.registration)},${a},${q(event)},${q(user(6))},'ATTENDED',${q(JSON.stringify({ qaFixture: marker }))},1,1,UTC_TIMESTAMP(3)` },
  { table: 'mip_event_checkins', id: ids.checkin, predicate: `registration_id=${q(ids.registration)} AND user_id=${q(user(6))} AND event_id=${q(event)}`, columns: 'id,app_id,event_id,registration_id,user_id,source', values: `${q(ids.checkin)},${a},${q(event)},${q(ids.registration)},${q(user(6))},'ADMIN'` },
  { table: 'mip_event_invitation_attributions', key: 'registration_id', id: ids.registration, predicate: `event_id=${q(event)} AND guest_user_id=${q(user(6))} AND inviter_user_id=${q(user(3))} AND source_type='USER'`, columns: 'app_id,registration_id,event_id,guest_user_id,source_type,inviter_user_id', values: `${a},${q(ids.registration)},${q(event)},${q(user(6))},'USER',${q(user(3))}` },
]
// Inspect all IDs before any writes. Existing unrelated rows are never adopted or overwritten.
for (const d of definitions) {
  const rows = read(`SELECT COUNT(*) AS total, SUM(CASE WHEN app_id=${a} AND ${d.predicate} THEN 1 ELSE 0 END) AS owned FROM ${d.table} WHERE ${d.key || 'id'}=${q(d.id)}`)[0]
  assert.equal(Number(rows.total), Number(rows.owned || 0), `Collision in ${d.table}`)
  d.exists = Number(rows.total) === 1
}
const cleanup = process.argv.includes('--cleanup')
if (!cleanup) {
  const conflicts = read(`SELECT id FROM mip_event_registrations WHERE app_id=${a} AND event_id=${q(event)} AND user_id=${q(user(6))} AND id<>${q(ids.registration)}`)
  assert.equal(conflicts.length, 0, 'Demo-6 already has an unrelated registration; do not overwrite')
}
let changed = 0
for (const d of cleanup ? definitions.toReversed() : definitions) {
  if (cleanup && d.exists) {
    write(`DELETE FROM ${d.table} WHERE app_id=${a} AND ${d.key || 'id'}=${q(d.id)} AND ${d.predicate}`)
    changed++
  }
  else if (!cleanup && !d.exists) {
    write(`INSERT INTO ${d.table} (${d.columns}) VALUES (${d.values})`)
    changed++
  }
}
const verified = definitions.map(d => ({ table: d.table, count: Number(read(`SELECT COUNT(*) AS count FROM ${d.table} WHERE app_id=${a} AND ${d.key || 'id'}=${q(d.id)} AND ${d.predicate}`)[0].count) }))
assert(verified.every(v => v.count === (cleanup ? 0 : 1)), 'Fixture readback incomplete')
const out = path.join(root, '.tmp/fixture-completion')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'summary.public.json'), JSON.stringify({ generatedAt: new Date().toISOString(), action: cleanup ? 'cleanup' : 'apply', stage: env.MIP_DEPLOYMENT_STAGE, changed, verified, synthetic: true, userScope: [1, 3, 4, 6], nativeAuthentication: false, limitations: ['签到事实为测试数据，不是扫码验收证据', 'demo6 增加演示到场事实，普通未参加角色仍为 demo4'] }, null, 2))
fs.writeFileSync(path.join(out, 'refs.private.json'), JSON.stringify({ hiddenOpportunityId: ids.opportunity, ...ids }), { mode: 0o600 })
console.log(JSON.stringify({ action: cleanup ? 'cleanup' : 'apply', changed, verified: verified.length, synthetic: true }))
