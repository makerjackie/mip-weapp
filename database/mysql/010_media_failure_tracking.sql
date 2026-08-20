-- Persist media review/upload failures without storing image bytes or provider
-- payloads. Failed uploaded objects continue through the existing cleanup outbox.

CREATE TABLE IF NOT EXISTS member_operational_failures (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  CONSTRAINT member_operational_failures_category_ck CHECK (
    category IN ('MEDIA_REVIEW', 'MEDIA_UPLOAD')
  ),
  CONSTRAINT member_operational_failures_resource_ck CHECK (
    resource_type IN ('avatar', 'event-photo', 'event-cover')
  ),
  CONSTRAINT member_operational_failures_status_ck CHECK (
    status IN ('OPEN', 'RESOLVED')
  ),
  CONSTRAINT member_operational_failures_version_ck CHECK (version > 0),
  KEY member_operational_failures_queue_idx (
    app_id, status, category, updated_at, id
  ),
  KEY member_operational_failures_user_idx (
    app_id, user_id, created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
