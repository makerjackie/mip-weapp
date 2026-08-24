CREATE TABLE IF NOT EXISTS mip_growth_levels (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  level_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  minimum_experience BIGINT UNSIGNED NOT NULL,
  benefits_json JSON NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_growth_levels_app_id_uk (app_id, id),
  UNIQUE KEY mip_growth_levels_key_uk (app_id, level_key),
  UNIQUE KEY mip_growth_levels_threshold_uk (app_id, minimum_experience),
  KEY mip_growth_levels_status_idx (app_id, status, minimum_experience, id),
  CONSTRAINT mip_growth_levels_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_growth_levels_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_growth_rules (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  metric VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta_value INT NOT NULL,
  daily_limit_value INT UNSIGNED NULL,
  source_event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_growth_rules_app_id_uk (app_id, id),
  UNIQUE KEY mip_growth_rules_key_uk (app_id, rule_key),
  KEY mip_growth_rules_event_idx (app_id, source_event_type, status, id),
  CONSTRAINT mip_growth_rules_metric_ck CHECK (metric IN ('EXPERIENCE', 'CONTRIBUTION', 'COIN')),
  CONSTRAINT mip_growth_rules_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_growth_rules_delta_ck CHECK (delta_value <> 0),
  CONSTRAINT mip_growth_rules_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_growth_accounts (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  experience_balance BIGINT UNSIGNED NOT NULL DEFAULT 0,
  contribution_balance BIGINT NOT NULL DEFAULT 0,
  coin_balance BIGINT NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  KEY mip_growth_accounts_experience_idx (app_id, experience_balance DESC, user_id),
  CONSTRAINT mip_growth_accounts_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_accounts_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_growth_entries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rule_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metric VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delta_value INT NOT NULL,
  balance_after BIGINT NOT NULL,
  adjustment_reason VARCHAR(300) NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_growth_entries_app_id_uk (app_id, id),
  UNIQUE KEY mip_growth_entries_source_uk (
    app_id, user_id, source_event_type, source_event_id, metric
  ),
  KEY mip_growth_entries_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_growth_entries_rule_day_idx (app_id, user_id, rule_id, created_at, id),
  CONSTRAINT mip_growth_entries_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_entries_rule_fk FOREIGN KEY (app_id, rule_id)
    REFERENCES mip_growth_rules (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_entries_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_entries_metric_ck CHECK (metric IN ('EXPERIENCE', 'CONTRIBUTION', 'COIN')),
  CONSTRAINT mip_growth_entries_delta_ck CHECK (delta_value <> 0),
  CONSTRAINT mip_growth_entries_balance_ck CHECK (metric <> 'EXPERIENCE' OR balance_after >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_inbox_messages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(500) NOT NULL,
  target_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_route VARCHAR(300) CHARACTER SET ascii COLLATE ascii_bin NULL,
  dedupe_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_inbox_messages_app_id_uk (app_id, id),
  UNIQUE KEY mip_inbox_messages_dedupe_uk (app_id, recipient_user_id, dedupe_key),
  KEY mip_inbox_messages_unread_idx (app_id, recipient_user_id, read_at, created_at DESC, id),
  CONSTRAINT mip_inbox_messages_recipient_fk FOREIGN KEY (app_id, recipient_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_inbox_messages_target_pair_ck CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type IS NOT NULL AND target_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_notification_grants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_ciphertext VARBINARY(512) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AVAILABLE',
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumed_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  UNIQUE KEY mip_notification_grants_app_id_uk (app_id, id),
  KEY mip_notification_grants_available_idx (
    app_id, user_id, channel, template_key, status, granted_at, id
  ),
  CONSTRAINT mip_notification_grants_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_notification_grants_channel_ck CHECK (
    channel IN ('WECHAT_SUBSCRIPTION', 'WECHAT_CUSTOMER_SERVICE', 'WECHAT_SERVICE_ACCOUNT')
  ),
  CONSTRAINT mip_notification_grants_status_ck CHECK (
    status IN ('AVAILABLE', 'CONSUMED', 'EXPIRED', 'REVOKED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_delivery_tasks (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inbox_message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_expires_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_delivery_tasks_app_id_uk (app_id, id),
  UNIQUE KEY mip_delivery_tasks_channel_uk (app_id, inbox_message_id, channel),
  KEY mip_delivery_tasks_lease_idx (app_id, status, available_at, lease_expires_at, id),
  CONSTRAINT mip_delivery_tasks_message_fk FOREIGN KEY (app_id, inbox_message_id)
    REFERENCES mip_inbox_messages (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_delivery_tasks_channel_ck CHECK (
    channel IN ('WECHAT_SUBSCRIPTION', 'WECHAT_CUSTOMER_SERVICE', 'WECHAT_SERVICE_ACCOUNT')
  ),
  CONSTRAINT mip_delivery_tasks_status_ck CHECK (
    status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_ai_drafts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audio_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_job_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  transcript_text TEXT NULL,
  structured_draft_json JSON NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UPLOADED',
  confirmed_resource_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  confirmed_resource_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_ai_drafts_app_id_uk (app_id, id),
  KEY mip_ai_drafts_user_idx (app_id, user_id, status, created_at DESC, id),
  KEY mip_ai_drafts_expiry_idx (app_id, status, expires_at, id),
  CONSTRAINT mip_ai_drafts_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_ai_drafts_audio_fk FOREIGN KEY (app_id, audio_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_ai_drafts_purpose_ck CHECK (
    purpose IN ('PROFILE', 'COOPERATION_CARD', 'SUPER_CASE')
  ),
  CONSTRAINT mip_ai_drafts_status_ck CHECK (
    status IN (
      'UPLOADED', 'TRANSCRIBING', 'STRUCTURING', 'DRAFT_READY',
      'FAILED', 'CONFIRMED', 'EXPIRED', 'DELETED'
    )
  ),
  CONSTRAINT mip_ai_drafts_confirmation_pair_ck CHECK (
    (confirmed_resource_type IS NULL AND confirmed_resource_id IS NULL)
    OR (status = 'CONFIRMED' AND confirmed_resource_type IS NOT NULL AND confirmed_resource_id IS NOT NULL)
  ),
  CONSTRAINT mip_ai_drafts_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
