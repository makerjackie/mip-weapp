CREATE TABLE IF NOT EXISTS mip_opportunity_comment_settings (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comments_enabled TINYINT(1) NOT NULL DEFAULT 1,
  reviews_enabled TINYINT(1) NOT NULL DEFAULT 1,
  calls_enabled TINYINT(1) NOT NULL DEFAULT 1,
  moderation_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AUTO',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, opportunity_id),
  CONSTRAINT mip_opportunity_comment_settings_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_settings_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_settings_mode_ck CHECK (moderation_mode IN ('AUTO', 'REVIEW')),
  CONSTRAINT mip_opportunity_comment_settings_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_comments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  author_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  body VARCHAR(800) NOT NULL,
  rating TINYINT UNSIGNED NULL,
  author_is_participant TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PASSED',
  call_count INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  edited_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  moderated_at DATETIME(3) NULL,
  moderated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  moderation_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  KEY mip_opportunity_comments_feed_idx (app_id, opportunity_id, status, created_at DESC, id DESC),
  KEY mip_opportunity_comments_author_idx (app_id, author_user_id, created_at DESC, id DESC),
  CONSTRAINT mip_opportunity_comments_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comments_author_fk FOREIGN KEY (app_id, author_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comments_moderator_fk FOREIGN KEY (app_id, moderated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comments_type_ck CHECK (comment_type IN ('COMMENT', 'REVIEW')),
  CONSTRAINT mip_opportunity_comments_rating_ck CHECK (
    (comment_type = 'COMMENT' AND rating IS NULL)
    OR (comment_type = 'REVIEW' AND rating BETWEEN 1 AND 5)
  ),
  CONSTRAINT mip_opportunity_comments_status_ck CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED')),
  CONSTRAINT mip_opportunity_comments_safety_ck CHECK (content_safety_status IN ('PASSED', 'REJECTED')),
  CONSTRAINT mip_opportunity_comments_state_ck CHECK (
    (status = 'PENDING' AND published_at IS NULL AND deleted_at IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'HIDDEN' AND deleted_at IS NULL AND moderated_at IS NOT NULL AND moderated_by_user_id IS NOT NULL)
    OR (status = 'DELETED' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT mip_opportunity_comments_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_comment_calls (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  called_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, comment_id, actor_user_id),
  KEY mip_opportunity_comment_calls_actor_idx (app_id, actor_user_id, status, called_at DESC),
  CONSTRAINT mip_opportunity_comment_calls_comment_fk FOREIGN KEY (app_id, comment_id)
    REFERENCES mip_opportunity_comments (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_calls_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_calls_status_ck CHECK (status IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT mip_opportunity_comment_calls_state_ck CHECK (
    (status = 'ACTIVE' AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT mip_opportunity_comment_calls_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_comment_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
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
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_opportunity_comment_reports_request_uk (app_id, reporter_user_id, request_id),
  KEY mip_opportunity_comment_reports_status_idx (app_id, status, created_at DESC, id DESC),
  CONSTRAINT mip_opportunity_comment_reports_comment_fk FOREIGN KEY (app_id, comment_id)
    REFERENCES mip_opportunity_comments (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_reports_reporter_fk FOREIGN KEY (app_id, reporter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_reports_reviewer_fk FOREIGN KEY (app_id, reviewed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_comment_reports_category_ck CHECK (
    category IN ('SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER')
  ),
  CONSTRAINT mip_opportunity_comment_reports_status_ck CHECK (
    status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT mip_opportunity_comment_reports_review_state_ck CHECK (
    (status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND resolution_reason IS NULL)
    OR (status = 'REVIEWING' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NULL)
    OR (status IN ('RESOLVED', 'DISMISSED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NOT NULL)
  ),
  CONSTRAINT mip_opportunity_comment_reports_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
