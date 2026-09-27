-- Apply only to the selected CloudBase MySQL schema. Business tables are untouched.
-- Millisecond timestamps fit safely in BIGINT and JavaScript numbers.
CREATE TABLE IF NOT EXISTS mip_admin_web_login_challenges (
 id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 browser_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status ENUM('PENDING','CONFIRMED','CONSUMED') NOT NULL,
 app_id VARCHAR(64), open_id VARCHAR(128), display_name VARCHAR(80),
 created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
 confirmed_at BIGINT NULL, consumed_at BIGINT NULL,
 pending_code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status = 'PENDING' THEN code_hash ELSE NULL END) STORED,
 UNIQUE KEY uq_admin_pending_code (pending_code_hash),
 KEY idx_admin_challenge_expiry (expires_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS mip_admin_web_login_principal_limits (
 principal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 failed_attempts INT UNSIGNED NOT NULL, window_started_at BIGINT NOT NULL,
 locked_until BIGINT NOT NULL, updated_at BIGINT NOT NULL,
 KEY idx_admin_principal_cleanup (updated_at, locked_until)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS mip_admin_web_login_ip_limits (
 ip_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 window_started_at BIGINT NOT NULL, hit_count INT UNSIGNED NOT NULL,
 KEY idx_admin_ip_cleanup (window_started_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS mip_admin_web_credentials (
 principal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 phone_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 app_id VARCHAR(64) NOT NULL, open_id VARCHAR(128) NOT NULL,
 user_id VARCHAR(128) NOT NULL, password_hash VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS mip_admin_web_sessions (
 id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 principal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 method ENUM('WECHAT','PASSWORD') NOT NULL, credential_version INT UNSIGNED NULL,
 expires_at BIGINT NOT NULL, revoked_at BIGINT NULL,
 KEY idx_admin_session_principal (principal_key), KEY idx_admin_session_expiry (expires_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS mip_admin_web_password_limits (
 `key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 window_started_at BIGINT NOT NULL, hit_count INT UNSIGNED NOT NULL,
 KEY idx_admin_password_cleanup (window_started_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS mip_admin_web_credential_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 principal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operation ENUM('PASSWORD_CONFIGURED','PASSWORD_CHANGED') NOT NULL,
 created_at BIGINT NOT NULL
) ENGINE=InnoDB;
