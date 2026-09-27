/** Explicit storage operations keep SQLite and MySQL dialects out of authentication policy. */
export interface AuthRunResult { success: boolean; meta?: { changes?: number } }
export interface AuthStatement {
  bind: (...values: unknown[]) => AuthStatement
  first: <T>() => Promise<T | null>
  run: () => Promise<AuthRunResult>
}
export interface D1DatabaseBinding { prepare: (query: string) => AuthStatement }
export interface AuthOperationDatabase { statement: (operation: AuthOperation) => AuthStatement }
export type AdminAuthDatabase = D1DatabaseBinding | AuthOperationDatabase
export type AuthOperation = keyof typeof d1Queries
export function authStatement(database: AdminAuthDatabase, operation: AuthOperation): AuthStatement {
  return 'statement' in database ? database.statement(operation) : database.prepare(d1Queries[operation])
}
// Preserve the original D1 statements so the existing deployment remains a rollback target.
export const d1Queries = {
  purgeLoginIpLimits: `DELETE FROM mip_admin_web_login_ip_limits WHERE window_started_at < ?1`,
  purgeChallenges: `DELETE FROM mip_admin_web_login_challenges WHERE expires_at < ?1`,
  insertChallenge: `INSERT INTO mip_admin_web_login_challenges
            (id, code_hash, browser_key_hash, status, created_at, expires_at)
           VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5)`,
  findChallenge: `SELECT id, status, app_id, open_id, display_name, expires_at
           FROM mip_admin_web_login_challenges
          WHERE id = ?1 AND browser_key_hash = ?2`,
  consumeChallenge: `UPDATE mip_admin_web_login_challenges
            SET status = 'CONSUMED', consumed_at = ?1
          WHERE id = ?2 AND browser_key_hash = ?3 AND status = 'CONFIRMED' AND consumed_at IS NULL`,
  findPrincipalLimit: `SELECT failed_attempts, locked_until
           FROM mip_admin_web_login_principal_limits
          WHERE principal_key = ?1`,
  clearPrincipalLimit: `DELETE FROM mip_admin_web_login_principal_limits WHERE principal_key = ?1`,
  hitLoginIp: `INSERT INTO mip_admin_web_login_ip_limits
      (ip_key, window_started_at, hit_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(ip_key) DO UPDATE SET
       hit_count = CASE
         WHEN window_started_at <= ?3 THEN 1
         ELSE hit_count + 1
       END,
       window_started_at = CASE
         WHEN window_started_at <= ?3 THEN ?2
         ELSE window_started_at
       END
     RETURNING window_started_at, hit_count`,
  failPrincipal: `INSERT INTO mip_admin_web_login_principal_limits
      (principal_key, failed_attempts, window_started_at, locked_until, updated_at)
     VALUES (?1, 1, ?2, 0, ?2)
     ON CONFLICT(principal_key) DO UPDATE SET
       failed_attempts = CASE
         WHEN locked_until > ?2 THEN failed_attempts
         WHEN window_started_at <= ?3 THEN 1
         ELSE failed_attempts + 1
       END,
       window_started_at = CASE
         WHEN locked_until > ?2 THEN window_started_at
         WHEN window_started_at <= ?3 THEN ?2
         ELSE window_started_at
       END,
       locked_until = CASE
         WHEN locked_until > ?2 THEN locked_until
         WHEN (CASE WHEN window_started_at <= ?3 THEN 1 ELSE failed_attempts + 1 END) >= ?4 THEN ?5
         ELSE 0
       END,
       updated_at = ?2
     RETURNING failed_attempts, locked_until`,
  confirmChallengeCode: `UPDATE mip_admin_web_login_challenges
            SET status = 'CONFIRMED', app_id = ?1, open_id = ?2, display_name = ?3, confirmed_at = ?4
          WHERE code_hash = ?5
            AND status = 'PENDING'
            AND expires_at >= ?4
            AND NOT EXISTS (
              SELECT 1
                FROM mip_admin_web_login_principal_limits
               WHERE principal_key = ?6 AND locked_until > ?4
            )`,
  confirmChallengeToken: `UPDATE mip_admin_web_login_challenges
            SET status = 'CONFIRMED', app_id = ?1, open_id = ?2, display_name = ?3, confirmed_at = ?4
          WHERE id = ?5
            AND status = 'PENDING'
            AND expires_at >= ?4
            AND NOT EXISTS (
              SELECT 1
                FROM mip_admin_web_login_principal_limits
               WHERE principal_key = ?6 AND locked_until > ?4
            )`,
  hitPasswordLimit: `INSERT INTO mip_admin_web_password_limits (key, window_started_at, hit_count)
      VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET
      hit_count = CASE WHEN window_started_at <= ?3 THEN 1 ELSE hit_count + 1 END,
      window_started_at = CASE WHEN window_started_at <= ?3 THEN ?2 ELSE window_started_at END
      RETURNING hit_count`,
  credentialByPrincipal: `SELECT * FROM mip_admin_web_credentials WHERE principal_key = ?1`,
  purgeSessions: `DELETE FROM mip_admin_web_sessions WHERE expires_at < ?1`,
  purgePasswordLimits: `DELETE FROM mip_admin_web_password_limits WHERE window_started_at < ?1`,
  insertSession: `INSERT INTO mip_admin_web_sessions (id, principal_key, method, credential_version, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
  findSession: `SELECT principal_key, method, credential_version, expires_at, revoked_at FROM mip_admin_web_sessions WHERE id = ?1`,
  revokeSession: `UPDATE mip_admin_web_sessions SET revoked_at = ?1 WHERE id = ?2`,
  updateCredential: `UPDATE mip_admin_web_credentials SET phone_key = ?1, user_id = ?2, password_hash = ?3, version = version + 1, updated_at = ?4 WHERE principal_key = ?5 AND version = ?6 RETURNING version`,
  insertCredential: `INSERT INTO mip_admin_web_credentials (principal_key, phone_key, app_id, open_id, user_id, password_hash, version, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7) RETURNING version`,
  credentialByPhone: `SELECT * FROM mip_admin_web_credentials WHERE phone_key = ?1`,
  clearPasswordLimit: `DELETE FROM mip_admin_web_password_limits WHERE key = ?1`,
} as const
