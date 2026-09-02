CREATE TABLE mip_admin_web_login_challenges_v2 (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  browser_key_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'CONSUMED')),
  app_id TEXT,
  open_id TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  consumed_at INTEGER,
  CHECK (
    (status = 'PENDING' AND app_id IS NULL AND open_id IS NULL AND confirmed_at IS NULL AND consumed_at IS NULL)
    OR (status = 'CONFIRMED' AND app_id IS NOT NULL AND open_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL)
    OR (status = 'CONSUMED' AND app_id IS NOT NULL AND open_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NOT NULL)
  )
) STRICT;

INSERT INTO mip_admin_web_login_challenges_v2 (
  id,
  code_hash,
  browser_key_hash,
  status,
  app_id,
  open_id,
  display_name,
  created_at,
  expires_at,
  confirmed_at,
  consumed_at
)
SELECT
  id,
  code_hash,
  browser_key_hash,
  status,
  app_id,
  open_id,
  display_name,
  created_at,
  expires_at,
  confirmed_at,
  consumed_at
FROM mip_admin_web_login_challenges;

DROP TABLE mip_admin_web_login_challenges;
ALTER TABLE mip_admin_web_login_challenges_v2 RENAME TO mip_admin_web_login_challenges;

CREATE UNIQUE INDEX idx_mip_admin_web_login_challenges_pending_code
  ON mip_admin_web_login_challenges (code_hash)
  WHERE status = 'PENDING';

CREATE INDEX idx_mip_admin_web_login_challenges_expiry
  ON mip_admin_web_login_challenges (expires_at, status);

CREATE TABLE mip_admin_web_login_principal_limits (
  principal_key TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL CHECK (failed_attempts >= 0),
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_mip_admin_web_login_principal_limits_cleanup
  ON mip_admin_web_login_principal_limits (updated_at, locked_until);
