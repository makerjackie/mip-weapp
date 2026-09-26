CREATE TABLE IF NOT EXISTS mip_opportunity_cooperations (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_opportunity_cooperations_user_uk (app_id, opportunity_id, user_id),
  KEY mip_opportunity_cooperations_list_idx (app_id, opportunity_id, status, activated_at DESC, id),
  KEY mip_opportunity_cooperations_mine_idx (app_id, user_id, status, activated_at DESC, id),
  CONSTRAINT mip_opportunity_cooperations_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_cooperations_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_cooperations_status_ck CHECK (status IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT mip_opportunity_cooperations_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
