CREATE TABLE IF NOT EXISTS mip_user_blocks (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocker_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocked_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  blocked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  unblocked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, blocker_user_id, blocked_user_id),
  KEY mip_user_blocks_target_idx (app_id, blocked_user_id, status, blocked_at DESC),
  CONSTRAINT mip_user_blocks_blocker_fk FOREIGN KEY (app_id, blocker_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_blocks_blocked_fk FOREIGN KEY (app_id, blocked_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_blocks_pair_ck CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT mip_user_blocks_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_user_blocks_state_ck CHECK (
    (status = 'ACTIVE' AND unblocked_at IS NULL)
    OR (status = 'INACTIVE' AND unblocked_at IS NOT NULL)
  ),
  CONSTRAINT mip_user_blocks_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(300) NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  resolution_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_reports_app_id_uk (app_id, id),
  UNIQUE KEY mip_reports_request_uk (app_id, reporter_user_id, request_id),
  KEY mip_reports_target_status_idx (app_id, target_user_id, status, created_at DESC, id DESC),
  KEY mip_reports_reporter_idx (app_id, reporter_user_id, created_at DESC, id DESC),
  CONSTRAINT mip_reports_reporter_fk FOREIGN KEY (app_id, reporter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_reports_target_fk FOREIGN KEY (app_id, target_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_reports_reviewer_fk FOREIGN KEY (app_id, reviewed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_reports_pair_ck CHECK (reporter_user_id <> target_user_id),
  CONSTRAINT mip_reports_category_ck CHECK (
    category IN ('SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER')
  ),
  CONSTRAINT mip_reports_status_ck CHECK (
    status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT mip_reports_review_state_ck CHECK (
    (status = 'PENDING'
      AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND resolution_reason IS NULL)
    OR (status = 'REVIEWING'
      AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NULL)
    OR (status IN ('RESOLVED', 'DISMISSED')
      AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NOT NULL)
  ),
  CONSTRAINT mip_reports_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
