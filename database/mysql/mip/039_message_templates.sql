CREATE TABLE IF NOT EXISTS mip_message_templates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  current_revision_number INT UNSIGNED NOT NULL DEFAULT 1,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_message_templates_app_id_uk (app_id, id),
  KEY mip_message_templates_scope_idx (
    app_id, scope_type, branch_id, status, updated_at DESC, id DESC
  ),
  CONSTRAINT mip_message_templates_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_templates_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_templates_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_templates_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT mip_message_templates_status_ck CHECK (
    status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')
  ),
  CONSTRAINT mip_message_templates_revision_ck CHECK (current_revision_number >= 1),
  CONSTRAINT mip_message_templates_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_message_template_revisions (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, template_id, revision_number),
  KEY mip_message_template_revisions_created_idx (app_id, template_id, created_at DESC),
  CONSTRAINT mip_message_template_revisions_template_fk FOREIGN KEY (app_id, template_id)
    REFERENCES mip_message_templates (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_template_revisions_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_template_revisions_number_ck CHECK (revision_number >= 1),
  CONSTRAINT mip_message_template_revisions_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'PASSED', 'REJECTED', 'ERROR')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
