CREATE TABLE IF NOT EXISTS mip_role_capability_policies (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_mode ENUM('CUSTOM', 'DEFAULT') NOT NULL DEFAULT 'CUSTOM',
  capabilities_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, role_key),
  KEY mip_role_capability_policies_updater_idx (app_id, updated_by_user_id, updated_at DESC),
  CONSTRAINT mip_role_capability_policies_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_role_capability_policies_role_ck CHECK (
    role_key IN (
      'PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN',
      'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF'
    )
  ),
  CONSTRAINT mip_role_capability_policies_capabilities_ck CHECK (
    JSON_TYPE(capabilities_json) = 'ARRAY'
    AND JSON_LENGTH(capabilities_json) <= 40
    AND (policy_mode = 'CUSTOM' OR JSON_LENGTH(capabilities_json) = 0)
  ),
  CONSTRAINT mip_role_capability_policies_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
