CREATE TABLE IF NOT EXISTS mip_profile_visits (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visitor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visit_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visited_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_profile_visits_key_uk (app_id, visitor_user_id, profile_user_id, visit_key),
  KEY mip_profile_visits_target_idx (app_id, profile_user_id, visited_at DESC, visitor_user_id, id),
  KEY mip_profile_visits_unread_idx (app_id, profile_user_id, read_at, visited_at DESC, visitor_user_id, id),
  CONSTRAINT mip_profile_visits_visitor_fk FOREIGN KEY (app_id, visitor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_profile_visits_profile_fk FOREIGN KEY (app_id, profile_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_profile_visits_pair_ck CHECK (visitor_user_id <> profile_user_id),
  CONSTRAINT mip_profile_visits_key_ck CHECK (CHAR_LENGTH(visit_key) >= 12)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
