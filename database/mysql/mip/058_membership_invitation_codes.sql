CREATE TABLE IF NOT EXISTS mip_membership_invitation_codes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inviter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scene_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  allocation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  allocation_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  allocation_object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
  code_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  expires_at DATETIME(3) NOT NULL,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_membership_invitation_codes_app_id_uk (app_id, id),
  UNIQUE KEY mip_membership_invitation_codes_scene_uk (app_id, inviter_user_id, scene_hash),
  UNIQUE KEY mip_membership_invitation_codes_allocation_uk (app_id, allocation_id),
  UNIQUE KEY mip_membership_invitation_codes_allocation_asset_uk (app_id, allocation_asset_id),
  UNIQUE KEY mip_membership_invitation_codes_allocation_object_uk (app_id, allocation_object_key),
  KEY mip_membership_invitation_codes_expiry_idx (app_id, status, expires_at, id),
  CONSTRAINT mip_membership_invitation_codes_inviter_fk FOREIGN KEY (app_id, inviter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_invitation_codes_asset_fk FOREIGN KEY (app_id, code_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_invitation_codes_scene_hash_ck CHECK (
    scene_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_membership_invitation_codes_allocation_ck CHECK (
    allocation_id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND allocation_asset_id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT mip_membership_invitation_codes_status_ck CHECK (
    status IN ('PENDING', 'READY', 'FAILED', 'EXPIRED')
  ),
  CONSTRAINT mip_membership_invitation_codes_lease_ck CHECK (
    (status = 'PENDING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'PENDING' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT mip_membership_invitation_codes_ready_asset_ck CHECK (
    status <> 'READY' OR code_asset_id IS NOT NULL
  ),
  CONSTRAINT mip_membership_invitation_codes_asset_allocation_ck CHECK (
    code_asset_id IS NULL OR code_asset_id = allocation_asset_id
  ),
  CONSTRAINT mip_membership_invitation_codes_object_key_ck CHECK (
    allocation_object_key IS NULL
    OR (
      allocation_object_key LIKE 'mip/%'
      AND allocation_object_key NOT LIKE '%..%'
      AND LOCATE(CHAR(92), allocation_object_key) = 0
    )
  ),
  CONSTRAINT mip_membership_invitation_codes_expiry_ck CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
