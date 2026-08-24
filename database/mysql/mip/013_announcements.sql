CREATE TABLE IF NOT EXISTS mip_announcements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  title VARCHAR(100) NOT NULL,
  summary VARCHAR(240) NOT NULL,
  body TEXT NOT NULL,
  target_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  visible_from DATETIME(3) NULL,
  visible_until DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  pin_scope_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'PUBLISHED' AND is_pinned = 1
          THEN IF(scope_type = 'PLATFORM', 'PLATFORM', CONCAT('BRANCH:', branch_id))
        ELSE NULL
      END
    ) STORED,
  UNIQUE KEY mip_announcements_app_id_uk (app_id, id),
  UNIQUE KEY mip_announcements_single_pin_uk (app_id, pin_scope_key),
  KEY mip_announcements_public_idx (
    app_id, status, scope_type, branch_id, is_pinned, published_at DESC, id DESC
  ),
  KEY mip_announcements_window_idx (app_id, status, visible_from, visible_until),
  CONSTRAINT mip_announcements_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_announcements_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_announcements_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_announcements_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT mip_announcements_target_ck CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type IN ('EVENT', 'OPPORTUNITY') AND target_id IS NOT NULL)
  ),
  CONSTRAINT mip_announcements_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')
  ),
  CONSTRAINT mip_announcements_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'PASSED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_announcements_window_ck CHECK (
    visible_until IS NULL OR (visible_from IS NOT NULL AND visible_until > visible_from)
  ),
  CONSTRAINT mip_announcements_state_ck CHECK (
    (status = 'DRAFT'
      AND published_at IS NULL AND withdrawn_at IS NULL AND is_pinned = 0)
    OR (status = 'PUBLISHED'
      AND published_at IS NOT NULL AND withdrawn_at IS NULL
      AND visible_from IS NOT NULL AND content_safety_status = 'PASSED')
    OR (status = 'WITHDRAWN'
      AND published_at IS NOT NULL AND withdrawn_at IS NOT NULL AND is_pinned = 0)
  ),
  CONSTRAINT mip_announcements_pin_ck CHECK (is_pinned IN (0, 1)),
  CONSTRAINT mip_announcements_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
