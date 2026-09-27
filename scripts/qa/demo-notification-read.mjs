/** QA only: executes the production mark-read SQL for fixed demo-3, not its transaction wrapper. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { callCloudbase, loadCaseEnv, sqlLiteral } from '../lib/example-cloudbase.mjs'
import { requireTestEnvironment } from './demo-role-policy.mjs'

export function markDemoNotificationsRead(userId, messageId) {
  const root = path.resolve(import.meta.dirname, '../..')
  const env = loadCaseEnv(root)
  requireTestEnvironment(env)
  assert.equal(userId, '50000000-0000-4000-8000-000000000003', 'Only demo-3 notification read state may change')
  assert(!messageId || /^[0-9a-f-]{36}$/i.test(messageId), 'Invalid message ID')
  const a = sqlLiteral(env.MINI_PROGRAM_APP_ID)
  const u = sqlLiteral(userId)
  const scope = `app_id=${a} AND recipient_user_id=${u}${messageId ? ` AND id=${sqlLiteral(messageId)}` : ''}`
  const query = (sql) => {
    const r = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
    assert.equal(r.success, true)
    return r.data.rows
  }
  const guard = query(`SELECT COUNT(*) AS count FROM mip_app_settings WHERE app_id=${a} AND setting_key='demo_seed_manifest' AND JSON_EXTRACT(value_json,'$.is_demo')=1 AND JSON_UNQUOTE(JSON_EXTRACT(value_json,'$.state'))='READY'`)[0]
  assert.equal(Number(guard.count), 1)
  const before = query(`SELECT COUNT(*) AS total, SUM(read_at IS NULL) AS unread FROM mip_inbox_messages WHERE ${scope}`)[0]
  assert(Number(before.total) > 0, 'No demo messages to test')
  const response = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql: `UPDATE mip_inbox_messages SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE ${scope} AND read_at IS NULL` })
  assert.notEqual(response.success, false)
  const after = query(`SELECT SUM(read_at IS NULL) AS unread, DATE_FORMAT(MAX(read_at),'%Y-%m-%dT%H:%i:%s.%fZ') AS read_at FROM mip_inbox_messages WHERE ${scope}`)[0]
  assert.equal(Number(after.unread), 0)
  return { readAt: after.read_at, ...(messageId ? { messageId } : {}), qaEvidence: { operation: 'atomic-sql-readback', beforeUnread: Number(before.unread), afterUnread: 0, transactionsTested: false } }
}

export function markDemoVisitorRead(userId) {
  const root = path.resolve(import.meta.dirname, '../..')
  const env = loadCaseEnv(root)
  requireTestEnvironment(env)
  assert.equal(userId, '50000000-0000-4000-8000-000000000003')
  const scope = `app_id=${sqlLiteral(env.MINI_PROGRAM_APP_ID)} AND profile_user_id=${sqlLiteral(userId)} AND id='fa927000-0000-4000-8000-000000000001' AND visitor_user_id='50000000-0000-4000-8000-000000000004' AND visit_key='qa-completion-20260927'`
  const response = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql: `UPDATE mip_profile_visits SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE ${scope}` })
  assert.notEqual(response.success, false)
  const result = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql: `SELECT DATE_FORMAT(read_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS read_at FROM mip_profile_visits WHERE ${scope}` })
  assert.equal(result.success, true)
  assert(result.data.rows.length === 1 && result.data.rows[0].read_at, 'Fixture visitor read state not saved')
  return { messageId: 'visitors', readAt: result.data.rows[0].read_at, qaEvidence: { operation: 'one-fixture-atomic-sql-readback', transactionsTested: false } }
}
