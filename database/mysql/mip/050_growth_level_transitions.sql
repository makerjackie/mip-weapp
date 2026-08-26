CREATE TABLE IF NOT EXISTS mip_growth_level_transitions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_level_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  from_level_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  from_level_name VARCHAR(80) NULL,
  to_level_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_level_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_level_name VARCHAR(80) NULL,
  source_event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  experience_before BIGINT NOT NULL,
  experience_after BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_growth_level_transitions_app_id_uk (app_id, id),
  UNIQUE KEY mip_growth_level_transitions_source_uk (
    app_id, user_id, source_event_type, source_event_id
  ),
  KEY mip_growth_level_transitions_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_growth_level_transitions_levels_idx (
    app_id, from_level_id, to_level_id, created_at DESC, id
  ),
  KEY mip_growth_level_transitions_created_idx (app_id, created_at DESC, id),
  CONSTRAINT mip_growth_level_transitions_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_level_transitions_experience_ck CHECK (
    experience_before >= 0 AND experience_after >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
