ALTER TABLE mip_events
  ADD COLUMN album_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER registration_policy,
  ADD COLUMN album_submission_policy VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'REVIEW' AFTER album_enabled,
  ADD CONSTRAINT mip_events_album_enabled_ck CHECK (album_enabled IN (0, 1)),
  ADD CONSTRAINT mip_events_album_submission_policy_ck CHECK (
    album_submission_policy IN ('AUTO', 'REVIEW')
  );

CREATE TABLE IF NOT EXISTS mip_event_album_photos (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  uploader_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caption VARCHAR(300) NOT NULL DEFAULT '',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  moderation_reason VARCHAR(300) NULL,
  reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_album_photos_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_album_photos_asset_uk (app_id, media_asset_id),
  KEY mip_event_album_photos_feed_idx (app_id, event_id, status, created_at DESC, id DESC),
  KEY mip_event_album_photos_uploader_idx (app_id, uploader_user_id, status, created_at DESC, id DESC),
  CONSTRAINT mip_event_album_photos_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_album_photos_uploader_fk FOREIGN KEY (app_id, uploader_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_album_photos_media_fk FOREIGN KEY (app_id, media_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_album_photos_reviewer_fk FOREIGN KEY (app_id, reviewed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_album_photos_status_ck CHECK (
    status IN ('PENDING', 'PUBLISHED', 'REJECTED', 'WITHDRAWN')
  ),
  CONSTRAINT mip_event_album_photos_moderation_ck CHECK (
    (status = 'PENDING'
      AND moderation_reason IS NULL AND reviewed_by_user_id IS NULL
      AND reviewed_at IS NULL AND published_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'REJECTED'
      AND moderation_reason IS NOT NULL AND moderation_reason <> ''
      AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND published_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL)
  ),
  CONSTRAINT mip_event_album_photos_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
