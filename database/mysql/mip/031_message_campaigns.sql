CREATE TABLE IF NOT EXISTS mip_message_campaigns (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  audience_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_user_ids_json JSON NOT NULL,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  withdrawal_reason VARCHAR(300) NULL,
  publish_idempotency_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
  publish_request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_message_campaigns_app_id_uk (app_id, id),
  KEY mip_message_campaigns_publish_request_idx (app_id, publish_idempotency_key),
  KEY mip_message_campaigns_scope_idx (app_id, scope_type, branch_id, status, updated_at DESC, id DESC),
  CONSTRAINT mip_message_campaigns_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaigns_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaigns_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaigns_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT mip_message_campaigns_audience_ck CHECK (
    (audience_type = 'ALL' AND JSON_LENGTH(audience_user_ids_json) = 0)
    OR (audience_type = 'EXPLICIT' AND JSON_LENGTH(audience_user_ids_json) BETWEEN 1 AND 100)
  ),
  CONSTRAINT mip_message_campaigns_status_ck CHECK (
    status IN ('DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN')
  ),
  CONSTRAINT mip_message_campaigns_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'PASSED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_message_campaigns_state_ck CHECK (
    (status = 'DRAFT' AND snapshot_at IS NULL AND published_at IS NULL AND withdrawn_at IS NULL AND recipient_count = 0)
    OR (status = 'READY' AND snapshot_at IS NOT NULL AND published_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'PUBLISHED' AND snapshot_at IS NOT NULL AND published_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'WITHDRAWN' AND snapshot_at IS NOT NULL AND published_at IS NOT NULL AND withdrawn_at IS NOT NULL)
  ),
  CONSTRAINT mip_message_campaigns_publish_ck CHECK (
    (publish_idempotency_key IS NULL AND publish_request_hash IS NULL)
    OR (publish_idempotency_key IS NOT NULL AND publish_request_hash IS NOT NULL)
  ),
  CONSTRAINT mip_message_campaigns_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_message_campaign_recipients (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  snapshot_at DATETIME(3) NOT NULL,
  PRIMARY KEY (app_id, campaign_id, recipient_user_id),
  KEY mip_message_campaign_recipients_user_idx (app_id, recipient_user_id, snapshot_at DESC),
  CONSTRAINT mip_message_campaign_recipients_campaign_fk FOREIGN KEY (app_id, campaign_id)
    REFERENCES mip_message_campaigns (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_recipients_user_fk FOREIGN KEY (app_id, recipient_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_recipients_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_recipients_kind_ck CHECK (
    recipient_kind IN ('PLAYER', 'GUEST')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
