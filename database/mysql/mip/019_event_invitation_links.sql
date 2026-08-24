CREATE TABLE IF NOT EXISTS mip_event_invitation_links (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inviter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scene_key CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_invitation_links_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_invitation_links_scene_uk (app_id, scene_key),
  KEY mip_event_invitation_links_owner_idx (app_id, inviter_user_id, status, created_at DESC, id),
  KEY mip_event_invitation_links_event_idx (app_id, event_id, status, expires_at, id),
  CONSTRAINT mip_event_invitation_links_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_links_inviter_fk FOREIGN KEY (app_id, inviter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_links_asset_fk FOREIGN KEY (app_id, code_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_links_status_ck CHECK (
    status IN ('ACTIVE', 'REVOKED', 'EXPIRED')
  ),
  CONSTRAINT mip_event_invitation_links_expiry_ck CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
