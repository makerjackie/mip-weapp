-- M05/P2: Create mip_admin_login_records and mip_admin_account_credentials
-- for admin authentication audit and credential management (Wave 2).

CREATE TABLE IF NOT EXISTS mip_admin_login_records (
  record_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  login_account VARCHAR(128) NOT NULL,
  result VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (record_id),
  KEY mip_admin_login_records_account_idx (login_account, created_at),
  KEY mip_admin_login_records_created_idx (created_at),
  CONSTRAINT mip_admin_login_records_result_ck CHECK (
    result IN ('SUCCESS', 'FAILED', 'LOCKED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_admin_account_credentials (
  credential_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  fails_count INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (credential_id),
  UNIQUE KEY mip_admin_account_credentials_account_uk (account_id),
  KEY mip_admin_account_credentials_locked_idx (locked_until),
  CONSTRAINT mip_admin_account_credentials_fails_ck CHECK (fails_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
