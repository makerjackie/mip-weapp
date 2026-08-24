CREATE TABLE IF NOT EXISTS mip_operations_messages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publication_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recipient_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  target_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  template_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  template_payload_json JSON NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PUBLISHED',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_operations_messages_app_id_uk (app_id, id),
  UNIQUE KEY mip_operations_messages_recipient_uk (
    app_id, publication_id, recipient_user_id
  ),
  KEY mip_operations_messages_inbox_idx (
    app_id, recipient_user_id, created_at DESC, id DESC
  ),
  KEY mip_operations_messages_event_idx (app_id, event_id, created_at DESC, id DESC),
  CONSTRAINT mip_operations_messages_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_operations_messages_recipient_fk FOREIGN KEY (app_id, recipient_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_operations_messages_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_operations_messages_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_operations_messages_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
    OR (scope_type = 'EVENT' AND branch_id IS NULL AND event_id IS NOT NULL)
    OR (scope_type = 'USER' AND branch_id IS NULL)
  ),
  CONSTRAINT mip_operations_messages_target_ck CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type = 'EVENT' AND target_id IS NOT NULL AND event_id = target_id)
  ),
  CONSTRAINT mip_operations_messages_template_ck CHECK (
    (template_key IS NULL AND template_payload_json IS NULL)
    OR (
      template_key = 'EVENT_REMINDER'
      AND scope_type = 'EVENT'
      AND event_id IS NOT NULL
      AND target_type = 'EVENT'
      AND target_id = event_id
      AND JSON_TYPE(template_payload_json) = 'OBJECT'
    )
  ),
  CONSTRAINT mip_operations_messages_status_ck CHECK (
    status IN ('PUBLISHED', 'CANCELLED')
  ),
  CONSTRAINT mip_operations_messages_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
