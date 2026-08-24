CREATE TABLE IF NOT EXISTS mip_banners (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  accessibility_label VARCHAR(120) NOT NULL,
  image_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_value VARCHAR(1024) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activated_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  KEY mip_banners_public_idx (app_id, status, sort_order, id),
  KEY mip_banners_asset_idx (app_id, image_asset_id, status),
  KEY mip_banners_updated_idx (app_id, updated_at DESC, id),
  CONSTRAINT mip_banners_asset_fk FOREIGN KEY (app_id, image_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_banners_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_banners_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_banners_target_ck CHECK (
    (target_type = 'MINIPROGRAM_PATH' AND target_value LIKE '/%')
    OR (target_type = 'ARTICLE_URL' AND target_value LIKE 'https://%')
  ),
  CONSTRAINT mip_banners_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'DELETED')),
  CONSTRAINT mip_banners_state_ck CHECK (
    (status = 'ACTIVE' AND activated_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'INACTIVE' AND deleted_at IS NULL)
    OR (status = 'DELETED' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT mip_banners_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
