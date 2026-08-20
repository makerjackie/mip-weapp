-- Append-only executable media cleanup outbox.
-- Does not modify 001/002/003 locked SQL. Requires member_media_assets present.

CREATE TABLE IF NOT EXISTS member_media_cleanup_outbox (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cloud_file_id VARCHAR(512) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_media_cleanup_outbox_status_ck CHECK (
    status IN ('PENDING', 'LEASED', 'DONE', 'FAILED')
  ),
  CONSTRAINT member_media_cleanup_outbox_version_ck CHECK (version > 0),
  CONSTRAINT member_media_cleanup_outbox_attempts_ck CHECK (attempts >= 0),
  UNIQUE KEY member_media_cleanup_outbox_media_uk (app_id, media_asset_id),
  KEY member_media_cleanup_outbox_retry_idx (app_id, status, next_retry_at),
  KEY member_media_cleanup_outbox_user_idx (app_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
