ALTER TABLE mip_task_cards
  ADD COLUMN assignment_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ALL' AFTER attachment_required,
  ADD COLUMN ends_at DATETIME(3) NULL AFTER assignment_mode,
  ADD COLUMN template_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ends_at,
  ADD KEY mip_task_cards_assignment_idx (app_id, status, assignment_mode, ends_at, id),
  ADD CONSTRAINT mip_task_cards_template_fk FOREIGN KEY (app_id, template_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_task_cards_assignment_mode_ck CHECK (assignment_mode IN ('ALL', 'SELECTED'));

CREATE TABLE IF NOT EXISTS mip_task_assignments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  assigned_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_task_assignments_user_uk (app_id, task_id, user_id),
  KEY mip_task_assignments_user_idx (app_id, user_id, status, task_id),
  KEY mip_task_assignments_status_idx (app_id, task_id, status, assigned_at, id),
  CONSTRAINT mip_task_assignments_task_fk FOREIGN KEY (app_id, task_id)
    REFERENCES mip_task_cards (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_assignments_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_assignments_assigner_fk FOREIGN KEY (app_id, assigned_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_assignments_revoker_fk FOREIGN KEY (app_id, revoked_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_assignments_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT mip_task_assignments_version_ck CHECK (version >= 1),
  CONSTRAINT mip_task_assignments_revoke_ck CHECK (
    (status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
