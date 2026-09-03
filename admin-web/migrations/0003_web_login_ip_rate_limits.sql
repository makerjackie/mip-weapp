CREATE TABLE mip_admin_web_login_ip_limits (
  ip_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL CHECK (hit_count >= 1)
) STRICT;

CREATE INDEX idx_mip_admin_web_login_ip_limits_cleanup
  ON mip_admin_web_login_ip_limits (window_started_at);
