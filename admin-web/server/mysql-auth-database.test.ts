import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMysqlAuthDatabase, type MysqlAuthConnection } from './mysql-auth-database.ts'
import { authStatement, d1Queries, type AuthOperation } from './auth-database.ts'

function setup(steps: { sql: RegExp; values?: unknown[]; result?: unknown; error?: Error }[]) {
  const lifecycle: string[] = []
  const connection: MysqlAuthConnection = {
    async beginTransaction() { lifecycle.push('begin') },
    async commit() { assert.equal(steps.length, 0); lifecycle.push('commit') },
    async rollback() { lifecycle.push('rollback') },
    release() { lifecycle.push('release') },
    async query(sql, values) {
      const step = steps.shift()
      assert.ok(step, `Unexpected query: ${sql}`)
      assert.match(sql, step.sql)
      if (step.values) assert.deepEqual(values, step.values)
      if (step.error) throw step.error
      return [step.result ?? { affectedRows: 1 }, undefined]
    },
  }
  return { database: createMysqlAuthDatabase({ async getConnection() { return connection } }), lifecycle }
}
describe('MySQL auth persistence transaction boundaries', () => {
  it('preserves every original D1 operation without translating SQL', () => {
    for (const name of Object.keys(d1Queries) as AuthOperation[]) {
      let query = ''
      authStatement({ prepare(sql) { query = sql; return {} as never } }, name)
      assert.equal(query, d1Queries[name])
    }
  })
  it('serializes rate-limit increments under a row lock and preserves active window', async () => {
    const { database, lifecycle } = setup([
      { sql: /ON DUPLICATE KEY UPDATE/, values: ['account', 100,] },
      { sql: /FOR UPDATE$/, result: [{ window_started_at: 90, hit_count: 4 }] },
      { sql: /UPDATE .* SET hit_count/, values: [5, 90, 'account'] },
    ])
    assert.deepEqual(await database.statement('hitPasswordLimit').bind('account', 100, 80).first(), { hit_count: 5, window_started_at: 90 })
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release'])
  })
  it('resets an expired IP window to exactly one hit', async () => {
    const { database } = setup([
      { sql: /INSERT INTO mip_admin_web_login_ip_limits/ },
      { sql: /FOR UPDATE$/, result: [{ window_started_at: 70, hit_count: 20 }] },
      { sql: /UPDATE/, values: [1, 100, 'ip'] },
    ])
    assert.deepEqual(await database.statement('hitLoginIp').bind('ip', 100, 80).first(), { hit_count: 1, window_started_at: 100 })
  })
  it('locks on the fifth principal failure without an off-by-one update', async () => {
    const { database } = setup([
      { sql: /INSERT INTO/ },
      { sql: /FOR UPDATE$/, result: [{ window_started_at: 90, failed_attempts: 4, locked_until: 0 }] },
      { sql: /UPDATE/, values: [5, 90, 200, 100, 'principal'] },
    ])
    assert.deepEqual(await database.statement('failPrincipal').bind('principal', 100, 80, 5, 200).first(), { failed_attempts: 5, locked_until: 200 })
  })
  it('does not confirm a challenge while the principal is locked', async () => {
    const { database } = setup([
      { sql: /INSERT INTO/ },
      { sql: /FOR UPDATE$/, result: [{ locked_until: 200 }] },
    ])
    assert.deepEqual(await database.statement('confirmChallengeCode').bind('app', 'open', 'name', 100, 'codehash', 'principal').run(), { success: true, meta: { changes: 0 } })
  })
  it('uses a one-time conditional update for challenge consumption', async () => {
    const { database } = setup([{ sql: /status = 'CONFIRMED' AND consumed_at IS NULL$/, result: { affectedRows: 0 } }])
    assert.equal((await database.statement('consumeChallenge').bind(100, 'challenge', 'browser').run()).meta?.changes, 0)
  })
  it('returns null on a stale credential CAS and does not append an audit', async () => {
    const { database, lifecycle } = setup([{ sql: /WHERE principal_key = \? AND version = \?$/, result: { affectedRows: 0 } }])
    assert.equal(await database.statement('updateCredential').bind('phone', 'user', 'hash', 100, 'principal', 2).first(), null)
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release'])
  })
  it('writes audit atomically and returns the incremented credential version', async () => {
    const { database } = setup([
      { sql: /UPDATE mip_admin_web_credentials/, result: { affectedRows: 1 } },
      { sql: /INSERT INTO mip_admin_web_credential_audit/, values: ['principal', 'PASSWORD_CHANGED', 100] },
    ])
    assert.deepEqual(await database.statement('updateCredential').bind('phone', 'user', 'hash', 100, 'principal', 2).first(), { version: 3 })
  })
  it('rolls back the credential when its audit insert fails, releasing the connection', async () => {
    const failure = new Error('audit storage failure')
    const { database, lifecycle } = setup([
      { sql: /INSERT INTO mip_admin_web_credentials/ },
      { sql: /INSERT INTO mip_admin_web_credential_audit/, error: failure },
    ])
    await assert.rejects(database.statement('insertCredential').bind('principal', 'phone', 'app', 'open', 'user', 'hash', 100).first(), failure)
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release'])
  })
})
