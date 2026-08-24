CREATE TABLE IF NOT EXISTS mip_digital_avatar_generations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_avatar_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  style_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PROCESSING',
  output_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_job_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_digital_avatar_generations_app_id_uk (app_id, id),
  UNIQUE KEY mip_digital_avatar_generations_request_uk (app_id, user_id, request_id),
  KEY mip_digital_avatar_generations_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_digital_avatar_generations_source_idx (app_id, source_avatar_asset_id, created_at DESC),
  CONSTRAINT mip_digital_avatar_generations_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_digital_avatar_generations_source_fk FOREIGN KEY (app_id, source_avatar_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_digital_avatar_generations_output_fk FOREIGN KEY (app_id, output_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_digital_avatar_generations_style_ck CHECK (
    style_key IN ('PROFESSIONAL', 'ILLUSTRATED', 'MONOCHROME')
  ),
  CONSTRAINT mip_digital_avatar_generations_status_ck CHECK (
    status IN ('PROCESSING', 'READY', 'FAILED')
  ),
  CONSTRAINT mip_digital_avatar_generations_result_ck CHECK (
    (status = 'PROCESSING' AND output_asset_id IS NULL AND failure_code IS NULL)
    OR (status = 'READY' AND output_asset_id IS NOT NULL AND failure_code IS NULL)
    OR (status = 'FAILED' AND output_asset_id IS NULL AND failure_code IS NOT NULL)
  ),
  CONSTRAINT mip_digital_avatar_generations_provider_hash_ck CHECK (
    provider_job_key_hash IS NULL OR provider_job_key_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_digital_avatar_generations_request_ck CHECK (
    request_id REGEXP '^[A-Za-z0-9_.:-]{8,128}$'
  ),
  CONSTRAINT mip_digital_avatar_generations_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
