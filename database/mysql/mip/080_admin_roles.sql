-- M05/P2: Create mip_admin_roles for the configurable RBAC subsystem (Wave 2).

CREATE TABLE IF NOT EXISTS mip_admin_roles (
  role_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_name VARCHAR(128) NOT NULL,
  description VARCHAR(500) NULL,
  capabilities JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  is_system TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (role_id),
  UNIQUE KEY mip_admin_roles_role_key_uk (role_key),
  KEY mip_admin_roles_status_idx (status, is_system),
  CONSTRAINT mip_admin_roles_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_admin_roles_is_system_ck CHECK (is_system IN (0, 1)),
  CONSTRAINT mip_admin_roles_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
