CREATE TABLE IF NOT EXISTS mip_task_level_rules (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  level_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, task_id, level_id),
  KEY mip_task_level_rules_level_idx (app_id, level_id, task_id),
  CONSTRAINT mip_task_level_rules_task_fk FOREIGN KEY (app_id, task_id)
    REFERENCES mip_task_cards (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_level_rules_level_fk FOREIGN KEY (app_id, level_id)
    REFERENCES mip_growth_levels (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_level_rules_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
