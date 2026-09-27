import assert from 'node:assert/strict'
/** Read-only TEST database acceptance. Local identity injection is not WeChat login. */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { bindAndRequireMysqlEnvironment, loadCaseEnv } from '../lib/example-cloudbase.mjs'
import { createReadOnlyDatabase } from './read-only-database.mjs'

const require = createRequire(import.meta.url)
const { createIdentityRepository } = require('../../cloudfunctions/mip-identity-api/domain/repository.js')
const { createIdentityService } = require('../../cloudfunctions/mip-identity-api/domain/service.js')
const { createTaskRepository } = require('../../cloudfunctions/mip-tasks-api/domain/repository.js')
const { createTaskService } = require('../../cloudfunctions/mip-tasks-api/domain/service.js')

const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(root, '.tmp/role-qa-20260926')
const env = loadCaseEnv(root)
assert(['development', 'test', 'staging'].includes(env.MIP_DEPLOYMENT_STAGE), 'Requires non-production environment')
assert.equal(env.MIP_CATALOG_STAGE, 'TEST')
assert.notEqual(env.MIP_PAYMENT_MODE, 'live')
bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID)
fs.mkdirSync(output, { recursive: true, mode: 0o700 })
const { db, queries } = createReadOnlyDatabase(root)
const repository = createIdentityRepository(db)
const fixtures = []
const checks = []
function check(name, fn, evidence = 'live-test-db/local-domain') {
  fn()
  checks.push({ name, status: 'PASS', evidence })
}
for (let number = 1; number <= 6; number++) {
  const userId = `50000000-0000-4000-8000-00000000000${number}`
  const caller = { appId: env.MINI_PROGRAM_APP_ID, userId }
  const user = await db.one('SELECT id, status, primary_branch_id, version FROM mip_users WHERE app_id = ? AND id = ?', [caller.appId, userId])
  assert(user, 'Expected existing demo user')
  const service = createIdentityService({ repository: { ...repository, findUserByIdentity: async () => user } })
  const snapshot = await service.getAccessSnapshot(caller)
  check(`demo-${number}: authenticated active profile`, () => {
    assert.equal(snapshot.authenticated, true)
    assert.equal(snapshot.userStatus, 'ACTIVE')
    assert.equal(snapshot.profile.complete, true)
  })
  check(`demo-${number}: membership projection`, () => assert.equal(snapshot.membership.kind, number <= 3 ? 'PLAYER' : 'GUEST'))
  check(`demo-${number}: no administrative grants`, () => assert.equal(snapshot.grants.length, 0))
  const attendance = await db.query('SELECT event_id, status FROM mip_event_registrations WHERE app_id = ? AND user_id = ? AND status = \'ATTENDED\'', [caller.appId, userId])
  fixtures.push({ actor: `demo-${number}`, evidence: 'live-test-db/local-domain/identity-injected', snapshot, attendance })
  fs.writeFileSync(path.join(output, 'responses.private.json'), JSON.stringify({ capturedAt: new Date().toISOString(), fixtures }, null, 2), { mode: 0o600 })
  console.log(`demo-${number}: identity and membership PASS
attended=${attendance.length}`)
}
// New-user and renewal are explicitly derived in memory
// No database identity/entitlement writes.
const ordinary = fixtures[3]
const ordinaryFacts = await repository.loadFacts(env.MINI_PROGRAM_APP_ID, ordinary.snapshot.userId)
const now = Date.now()
for (const [name, entitlement, expected] of [
  ['renewal', { status: 'ACTIVE', startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 86400000).toISOString() }, 'PLAYER'],
  ['expired', { status: 'ACTIVE', startsAt: new Date(now - 172800000).toISOString(), endsAt: new Date(now - 86400000).toISOString() }, 'GUEST'],
]) {
  const service = createIdentityService({ repository: { ...repository, findUserByIdentity: async () => ordinaryFacts.user, loadFacts: async () => ordinaryFacts }, entitlementReader: { load: async () => ({ source: 'ENTITLEMENT', entitlement }) } })
  const snapshot = await service.getAccessSnapshot({ appId: env.MINI_PROGRAM_APP_ID })
  check(`${name}: entitlement boundary`, () => assert.equal(snapshot.membership.kind, expected), 'derived-snapshot/local-domain')
  fixtures.push({ actor: name, evidence: 'derived-snapshot/local-domain/identity-injected', snapshot })
}
const anonymousService = createIdentityService({ repository: { findUserByIdentity: async () => null } })
const anonymous = await anonymousService.getAccessSnapshot({ appId: env.MINI_PROGRAM_APP_ID })
check('visitor: unauthenticated and no grants', () => {
  assert.equal(anonymous.authenticated, false)
  assert.equal(anonymous.grants.length, 0)
}, 'simulated-local-domain')
fixtures.push({ actor: 'visitor', evidence: 'simulated-local-domain', snapshot: anonymous })
const taskService = createTaskService(createTaskRepository(db))
for (const fixture of [fixtures[0], fixtures[3]]) {
  const caller = { appId: env.MINI_PROGRAM_APP_ID, userId: fixture.snapshot.userId, profileRefSecret: 'local-qa-only-not-a-production-secret-32' }
  for (const filter of ['pending', 'ended']) {
    const response = await taskService.listTasks(caller, { filter, limit: 10 })
    fixture[`tasks_${filter}`] = response
    check(`${fixture.actor}: ${filter} task response`, () => assert(Array.isArray(response.items)))
  }
  await assert.rejects(() => taskService.getAdminSession(caller), /FORBIDDEN/)
  checks.push({ name: `${fixture.actor}: administrator access denied`, status: 'PASS', evidence: 'live-test-db/local-domain' })
}
fs.writeFileSync(path.join(output, 'responses.private.json'), JSON.stringify({ capturedAt: new Date().toISOString(), fixtures, queries }, null, 2), { mode: 0o600 })
const summary = { capturedAt: new Date().toISOString(), stage: env.MIP_DEPLOYMENT_STAGE, catalog: 'TEST', databaseWrites: 0, realWechatLogin: false, checks, counts: { passed: checks.length, failed: 0, liveDemoActors: 6, derivedActors: 3 }, limitations: ['Local trusted identity injection, no WeChat sign-in claim', 'Renewal and expired entitlement windows are in-memory derived scenarios', 'Native phone, payment and scan require real-device acceptance'] }
fs.writeFileSync(path.join(output, 'summary.public.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary.counts))
