CREATE TABLE IF NOT EXISTS mip_user_access_controls (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  control_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  reason VARCHAR(300) NOT NULL,
  previous_user_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revoked_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revoked_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_user_access_controls_app_id_uk (app_id, id),
  UNIQUE KEY mip_user_access_controls_user_type_uk (app_id, user_id, control_type),
  KEY mip_user_access_controls_status_idx (app_id, control_type, status, updated_at DESC, id),
  CONSTRAINT mip_user_access_controls_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_access_controls_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_access_controls_revoker_fk FOREIGN KEY (app_id, revoked_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_access_controls_type_ck CHECK (control_type IN ('ALLOWLIST', 'BLOCKLIST')),
  CONSTRAINT mip_user_access_controls_previous_status_ck CHECK (
    (control_type = 'ALLOWLIST' AND previous_user_status IS NULL)
    OR (control_type = 'BLOCKLIST' AND previous_user_status IN ('ACTIVE', 'BLOCKED', 'CLOSED'))
  ),
  CONSTRAINT mip_user_access_controls_status_ck CHECK (
    (status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT mip_user_access_controls_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_admin_export_tickets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  export_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  filters_json JSON NOT NULL,
  includes_phone TINYINT(1) NOT NULL DEFAULT 0,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cloud_file_id VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  content_bytes BIGINT UNSIGNED NULL,
  row_count INT UNSIGNED NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  reserved_until DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  failed_reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_admin_export_tickets_app_id_uk (app_id, id),
  UNIQUE KEY mip_admin_export_tickets_token_uk (app_id, token_hash),
  UNIQUE KEY mip_admin_export_tickets_object_uk (app_id, object_key),
  KEY mip_admin_export_tickets_status_idx (app_id, status, expires_at, id),
  KEY mip_admin_export_tickets_requester_idx (app_id, requested_by_user_id, created_at DESC, id),
  CONSTRAINT mip_admin_export_tickets_requester_fk FOREIGN KEY (app_id, requested_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_admin_export_tickets_type_ck CHECK (
    export_type IN ('USERS', 'EVENT_ROSTER', 'EVENT_ORDERS', 'ORDERS', 'GROWTH_ENTRIES')
  ),
  CONSTRAINT mip_admin_export_tickets_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND scope_id IS NULL)
    OR (scope_type IN ('BRANCH', 'EVENT') AND scope_id IS NOT NULL)
  ),
  CONSTRAINT mip_admin_export_tickets_phone_ck CHECK (includes_phone IN (0, 1)),
  CONSTRAINT mip_admin_export_tickets_object_key_ck CHECK (object_key LIKE 'mip/exports/%'),
  CONSTRAINT mip_admin_export_tickets_status_ck CHECK (
    status IN ('PENDING', 'READY', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REVOKED', 'FAILED')
  ),
  CONSTRAINT mip_admin_export_tickets_file_ck CHECK (
    (
      cloud_file_id IS NULL
      AND content_sha256 IS NULL
      AND content_bytes IS NULL
      AND row_count IS NULL
      AND status IN ('PENDING', 'FAILED', 'REVOKED', 'EXPIRED')
    )
    OR (
      cloud_file_id LIKE 'cloud://%'
      AND content_sha256 IS NOT NULL
      AND content_bytes IS NOT NULL
      AND row_count IS NOT NULL
      AND status IN ('READY', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REVOKED')
    )
  ),
  CONSTRAINT mip_admin_export_tickets_expiry_ck CHECK (
    expires_at > created_at AND expires_at <= DATE_ADD(created_at, INTERVAL 1 DAY)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
