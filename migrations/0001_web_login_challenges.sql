CREATE TABLE IF NOT EXISTS mip_admin_web_login_challenges (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
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

CREATE INDEX IF NOT EXISTS idx_mip_admin_web_login_challenges_expiry
  ON mip_admin_web_login_challenges (expires_at, status);
