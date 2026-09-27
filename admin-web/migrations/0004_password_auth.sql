-- Passwords are an optional credential for an already verified WeChat principal.
CREATE TABLE mip_admin_web_credentials (
  principal_key TEXT PRIMARY KEY,
  phone_key TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL,
  open_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE mip_admin_web_sessions (
  id TEXT PRIMARY KEY,
  principal_key TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('WECHAT','PASSWORD')),
  credential_version INTEGER,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX idx_mip_admin_web_sessions_principal ON mip_admin_web_sessions(principal_key);
CREATE INDEX idx_mip_admin_web_sessions_expiry ON mip_admin_web_sessions(expires_at);
CREATE TABLE mip_admin_web_password_limits (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL
) STRICT;
CREATE TABLE mip_admin_web_credential_audit (
  id INTEGER PRIMARY KEY,
  principal_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER mip_admin_web_credential_created AFTER INSERT ON mip_admin_web_credentials
BEGIN
  INSERT INTO mip_admin_web_credential_audit(principal_key, operation, created_at)
  VALUES(NEW.principal_key, 'PASSWORD_CONFIGURED', NEW.updated_at);
END;
CREATE TRIGGER mip_admin_web_credential_changed AFTER UPDATE ON mip_admin_web_credentials
BEGIN
  INSERT INTO mip_admin_web_credential_audit(principal_key, operation, created_at)
  VALUES(NEW.principal_key, 'PASSWORD_CHANGED', NEW.updated_at);
END;
