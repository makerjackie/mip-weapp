import type { AuthOperation, AuthOperationDatabase, AuthRunResult, AuthStatement } from './auth-database.ts'

/** Structural subset of mysql2/promise; runtime owns pool creation and credentials. */
export interface MysqlAuthConnection {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}
export interface MysqlAuthPool { getConnection(): Promise<MysqlAuthConnection> }
type Row = Record<string, unknown>
type Outcome = { row?: Row | null; changes?: number }
const statements: Partial<Record<AuthOperation, string>> = {
  purgeLoginIpLimits: 'DELETE FROM mip_admin_web_login_ip_limits WHERE window_started_at < ?',
  purgeChallenges: 'DELETE FROM mip_admin_web_login_challenges WHERE expires_at < ?',
  insertChallenge: "INSERT INTO mip_admin_web_login_challenges (id, code_hash, browser_key_hash, status, created_at, expires_at) VALUES (?, ?, ?, 'PENDING', ?, ?)",
  findChallenge: 'SELECT id, status, app_id, open_id, display_name, expires_at FROM mip_admin_web_login_challenges WHERE id = ? AND browser_key_hash = ?',
  consumeChallenge: "UPDATE mip_admin_web_login_challenges SET status = 'CONSUMED', consumed_at = ? WHERE id = ? AND browser_key_hash = ? AND status = 'CONFIRMED' AND consumed_at IS NULL",
  findPrincipalLimit: 'SELECT failed_attempts, locked_until FROM mip_admin_web_login_principal_limits WHERE principal_key = ?',
  clearPrincipalLimit: 'DELETE FROM mip_admin_web_login_principal_limits WHERE principal_key = ?',
  credentialByPrincipal: 'SELECT * FROM mip_admin_web_credentials WHERE principal_key = ?',
  credentialByPhone: 'SELECT * FROM mip_admin_web_credentials WHERE phone_key = ?',
  purgeSessions: 'DELETE FROM mip_admin_web_sessions WHERE expires_at < ?',
  purgePasswordLimits: 'DELETE FROM mip_admin_web_password_limits WHERE window_started_at < ?',
  clearPasswordLimit: 'DELETE FROM mip_admin_web_password_limits WHERE `key` = ?',
  insertSession: 'INSERT INTO mip_admin_web_sessions (id, principal_key, method, credential_version, expires_at) VALUES (?, ?, ?, ?, ?)',
  findSession: 'SELECT principal_key, method, credential_version, expires_at, revoked_at FROM mip_admin_web_sessions WHERE id = ?',
  revokeSession: 'UPDATE mip_admin_web_sessions SET revoked_at = ? WHERE id = ?',
}
async function execute(connection: MysqlAuthConnection, sql: string, values: unknown[]): Promise<Outcome> {
  const [result] = await connection.query(sql, values)
  return Array.isArray(result)
    ? { row: result[0] as Row ?? null }
    : { changes: Number((result as { affectedRows?: number }).affectedRows ?? 0) }
}
async function operation(connection: MysqlAuthConnection, name: AuthOperation, values: unknown[]): Promise<Outcome> {
  const sql = statements[name]
  if (sql) return execute(connection, sql, values)
  if (name === 'hitLoginIp' || name === 'hitPasswordLimit') {
    // Table and key names are fixed code, never user input. Row lock serializes increments.
    const table = name === 'hitLoginIp' ? 'mip_admin_web_login_ip_limits' : 'mip_admin_web_password_limits'
    const key = name === 'hitLoginIp' ? 'ip_key' : '`key`'
    const [id, now, cutoff] = values
    await execute(connection, `INSERT INTO ${table} (${key}, window_started_at, hit_count) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE ${key} = ${key}`, [id, now])
    const { row } = await execute(connection, `SELECT window_started_at, hit_count FROM ${table} WHERE ${key} = ? FOR UPDATE`, [id])
    if (!row) throw new Error('Auth counter missing')
    const expired = Number(row.window_started_at) <= Number(cutoff)
    const count = expired ? 1 : Number(row.hit_count) + 1
    const start = expired ? now : row.window_started_at
    await execute(connection, `UPDATE ${table} SET hit_count = ?, window_started_at = ? WHERE ${key} = ?`, [count, start, id])
    return { row: { hit_count: count, window_started_at: start } }
  }
  if (name === 'failPrincipal') {
    const [key, now, cutoff, maximum, until] = values
    await execute(connection, 'INSERT INTO mip_admin_web_login_principal_limits (principal_key, failed_attempts, window_started_at, locked_until, updated_at) VALUES (?, 0, ?, 0, ?) ON DUPLICATE KEY UPDATE principal_key = principal_key', [key, now, now])
    const { row } = await execute(connection, 'SELECT failed_attempts, window_started_at, locked_until FROM mip_admin_web_login_principal_limits WHERE principal_key = ? FOR UPDATE', [key])
    if (!row) throw new Error('Auth principal counter missing')
    const locked = Number(row.locked_until) > Number(now)
    const expired = Number(row.window_started_at) <= Number(cutoff)
    const count = locked ? Number(row.failed_attempts) : expired ? 1 : Number(row.failed_attempts) + 1
    const lockUntil = locked ? row.locked_until : count >= Number(maximum) ? until : 0
    const start = !locked && expired ? now : row.window_started_at
    await execute(connection, 'UPDATE mip_admin_web_login_principal_limits SET failed_attempts = ?, window_started_at = ?, locked_until = ?, updated_at = ? WHERE principal_key = ?', [count, start, lockUntil, now, key])
    return { row: { failed_attempts: count, locked_until: lockUntil } }
  }
  if (name === 'confirmChallengeCode' || name === 'confirmChallengeToken') {
    const [app, open, display, now, selector, principal] = values
    // Lock the same principal counter as failPrincipal before confirming to avoid a race with lockout.
    await execute(connection, 'INSERT INTO mip_admin_web_login_principal_limits (principal_key, failed_attempts, window_started_at, locked_until, updated_at) VALUES (?, 0, ?, 0, ?) ON DUPLICATE KEY UPDATE principal_key = principal_key', [principal, now, now])
    const { row } = await execute(connection, 'SELECT locked_until FROM mip_admin_web_login_principal_limits WHERE principal_key = ? FOR UPDATE', [principal])
    if (!row || Number(row.locked_until) > Number(now)) return { changes: 0 }
    const selectorColumn = name === 'confirmChallengeCode' ? 'code_hash' : 'id'
    return execute(connection, `UPDATE mip_admin_web_login_challenges SET status = 'CONFIRMED', app_id = ?, open_id = ?, display_name = ?, confirmed_at = ? WHERE ${selectorColumn} = ? AND status = 'PENDING' AND expires_at >= ?`, [app, open, display, now, selector, now])
  }
  if (name === 'updateCredential' || name === 'insertCredential') {
    let key: unknown, updated: unknown, version: number
    if (name === 'updateCredential') {
      key = values[4]; updated = values[3]; version = Number(values[5]) + 1
      const result = await execute(connection, 'UPDATE mip_admin_web_credentials SET phone_key = ?, user_id = ?, password_hash = ?, version = version + 1, updated_at = ? WHERE principal_key = ? AND version = ?', values)
      if (result.changes !== 1) return { row: null }
    } else {
      key = values[0]; updated = values[6]; version = 1
      await execute(connection, 'INSERT INTO mip_admin_web_credentials (principal_key, phone_key, app_id, open_id, user_id, password_hash, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', values)
    }
    // Credential and audit are committed together. No trigger privileges are required.
    await execute(connection, 'INSERT INTO mip_admin_web_credential_audit (principal_key, operation, created_at) VALUES (?, ?, ?)', [key, name === 'insertCredential' ? 'PASSWORD_CONFIGURED' : 'PASSWORD_CHANGED', updated])
    return { row: { version } }
  }
  throw new Error(`Unsupported auth operation: ${name}`)
}
export function createMysqlAuthDatabase(pool: MysqlAuthPool): AuthOperationDatabase {
  async function perform(name: AuthOperation, values: unknown[]): Promise<Outcome> {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await operation(connection, name, values)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback().catch(() => {})
      throw error
    } finally { connection.release() }
  }
  return { statement(name) {
    let values: unknown[] = []
    const statement: AuthStatement = {
      bind(...input) { values = input; return statement },
      async first<T>() { return (await perform(name, values)).row as T ?? null },
      async run(): Promise<AuthRunResult> { return { success: true, meta: { changes: (await perform(name, values)).changes ?? 0 } } },
    }
    return statement
  } }
}
