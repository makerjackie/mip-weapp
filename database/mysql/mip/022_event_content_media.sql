CREATE TABLE IF NOT EXISTS mip_event_content_media (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  caption VARCHAR(120) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, event_id, media_asset_id),
  KEY mip_event_content_media_order_idx (app_id, event_id, status, sort_order, media_asset_id),
  KEY mip_event_content_media_asset_idx (app_id, media_asset_id),
  CONSTRAINT mip_event_content_media_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_content_media_asset_fk FOREIGN KEY (app_id, media_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_content_media_order_ck CHECK (sort_order < 20),
  CONSTRAINT mip_event_content_media_status_ck CHECK (status IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT mip_event_content_media_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
