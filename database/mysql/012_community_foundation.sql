-- Low-maintenance community foundation: official announcements, reversible
-- member blocks, and an audited report review queue.

CREATE TABLE IF NOT EXISTS member_announcements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(320) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  visible_from DATETIME(3) NULL,
  visible_until DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  created_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_announcements_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')
  ),
  CONSTRAINT member_announcements_pinned_ck CHECK (is_pinned IN (0, 1)),
  CONSTRAINT member_announcements_window_ck CHECK (
    visible_until IS NULL OR visible_from IS NULL OR visible_until > visible_from
  ),
  CONSTRAINT member_announcements_version_ck CHECK (version > 0),
  KEY member_announcements_public_idx (
    app_id, status, is_pinned, visible_from, visible_until, published_at DESC, id
  ),
  KEY member_announcements_admin_idx (app_id, status, updated_at DESC, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_blocks (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocker_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blocked_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, blocker_user_id, blocked_user_id),
  CONSTRAINT member_blocks_not_self_ck CHECK (blocker_user_id <> blocked_user_id),
  KEY member_blocks_reverse_idx (app_id, blocked_user_id, blocker_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(400) NOT NULL DEFAULT '',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  resolution_action VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution_reason VARCHAR(400) NULL,
  handled_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  handled_at DATETIME(3) NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_reports_not_self_ck CHECK (reporter_user_id <> target_user_id),
  CONSTRAINT member_reports_category_ck CHECK (
    category IN ('HARASSMENT', 'SPAM', 'FRAUD', 'INAPPROPRIATE', 'PRIVACY', 'OTHER')
  ),
  CONSTRAINT member_reports_status_ck CHECK (
    status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT member_reports_action_ck CHECK (
    resolution_action IS NULL
    OR resolution_action IN ('NONE', 'WARNING', 'HIDE_PROFILE', 'SUSPEND_ACCOUNT')
  ),
  CONSTRAINT member_reports_version_ck CHECK (version > 0),
  UNIQUE KEY member_reports_idempotency_uk (app_id, reporter_user_id, idempotency_key),
  KEY member_reports_queue_idx (app_id, status, created_at, id),
  KEY member_reports_target_idx (app_id, target_user_id, status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
