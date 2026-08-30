CREATE TABLE IF NOT EXISTS mip_ai_draft_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draft_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PROCESSING',
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  draft_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audio_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  audio_object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
  response_json JSON NULL,
  failure_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_ai_draft_requests_scope_uk (app_id, user_id, request_id),
  KEY mip_ai_draft_requests_expiry_idx (expires_at, app_id, status),
  KEY mip_ai_draft_requests_draft_idx (app_id, user_id, draft_id),
  KEY mip_ai_draft_requests_asset_idx (app_id, audio_asset_id),
  CONSTRAINT mip_ai_draft_requests_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_ai_draft_requests_request_ck CHECK (
    request_id REGEXP '^[A-Za-z0-9_.:-]{8,128}$'
  ),
  CONSTRAINT mip_ai_draft_requests_hash_ck CHECK (
    input_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_ai_draft_requests_kind_ck CHECK (
    draft_kind IN ('TEXT', 'VOICE_ASSET', 'VOICE_UPLOAD')
  ),
  CONSTRAINT mip_ai_draft_requests_status_ck CHECK (
    status IN ('PROCESSING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT mip_ai_draft_requests_lease_ck CHECK (
    (status = 'PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status IN ('COMPLETED', 'FAILED') AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT mip_ai_draft_requests_result_ck CHECK (
    (status = 'PROCESSING' AND response_json IS NULL AND failure_code IS NULL)
    OR (status = 'COMPLETED' AND response_json IS NOT NULL AND failure_code IS NULL)
    OR (status = 'FAILED' AND response_json IS NULL AND failure_code IS NOT NULL)
  ),
  CONSTRAINT mip_ai_draft_requests_upload_ck CHECK (
    (draft_kind = 'VOICE_UPLOAD' AND audio_asset_id IS NOT NULL AND audio_object_key IS NOT NULL)
    OR (draft_kind <> 'VOICE_UPLOAD' AND audio_object_key IS NULL)
  ),
  CONSTRAINT mip_ai_draft_requests_failure_ck CHECK (
    failure_code IS NULL OR failure_code REGEXP '^[A-Z][A-Z0-9_]{2,63}$'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
