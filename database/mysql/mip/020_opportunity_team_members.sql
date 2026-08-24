CREATE TABLE IF NOT EXISTS mip_opportunity_team_members (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_opportunity_team_members_app_id_uk (app_id, id),
  UNIQUE KEY mip_opportunity_team_members_user_uk (app_id, opportunity_id, user_id),
  KEY mip_opportunity_team_members_user_idx (app_id, user_id, status, updated_at DESC, id),
  KEY mip_opportunity_team_members_list_idx (app_id, opportunity_id, status, sort_order, id),
  CONSTRAINT mip_opportunity_team_members_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_team_members_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_team_members_status_ck CHECK (status IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT mip_opportunity_team_members_time_ck CHECK (
    (status = 'ACTIVE' AND removed_at IS NULL)
    OR (status = 'REMOVED' AND removed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
