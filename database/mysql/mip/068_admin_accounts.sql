-- M05: Create mip_admin_accounts for admin-web account management.

CREATE TABLE IF NOT EXISTS mip_admin_accounts (
  account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  login_account VARCHAR(128) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  role_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id),
  UNIQUE KEY mip_admin_accounts_login_uk (login_account),
  KEY mip_admin_accounts_role_idx (role_key, status),
  KEY mip_admin_accounts_status_idx (status),
  CONSTRAINT mip_admin_accounts_status_ck CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
  CONSTRAINT mip_admin_accounts_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
