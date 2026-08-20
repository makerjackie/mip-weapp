-- Reusable member notifications and durable WeChat subscribe-message delivery.
-- In-app notifications remain available even when an operator has not configured
-- WeChat template IDs or a member declines a one-time subscription.

CREATE TABLE IF NOT EXISTS member_notifications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  page_path VARCHAR(500) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UNREAD',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_notifications_kind_ck CHECK (
    kind IN (
      'REGISTRATION_RESULT',
      'EVENT_UPDATE',
      'EVENT_REMINDER',
      'EVENT_CANCEL',
      'REFUND_RESULT'
    )
  ),
  CONSTRAINT member_notifications_status_ck CHECK (
    status IN ('UNREAD', 'READ', 'DISMISSED')
  ),
  CONSTRAINT member_notifications_source_version_ck CHECK (source_version > 0),
  UNIQUE KEY member_notifications_source_uk (
    app_id, user_id, kind, source_type, source_id, source_version
  ),
  KEY member_notifications_inbox_idx (app_id, user_id, status, created_at DESC, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_notification_subscriptions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  template_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_notification_subscriptions_key_ck CHECK (
    template_key IN ('registration', 'event_update', 'event_reminder', 'event_cancel', 'refund')
  ),
  CONSTRAINT member_notification_subscriptions_status_ck CHECK (
    status IN ('ACCEPTED', 'REJECTED', 'BANNED', 'FILTERED')
  ),
  KEY member_notification_subscriptions_available_idx (
    app_id, user_id, event_id, template_key, status, consumed_at, created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_notification_outbox (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  template_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  page_path VARCHAR(500) NOT NULL,
  send_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  lease_owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  provider_msg_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_notification_outbox_notification_fk
    FOREIGN KEY (notification_id) REFERENCES member_notifications(id) ON DELETE CASCADE,
  CONSTRAINT member_notification_outbox_status_ck CHECK (
    status IN ('PENDING', 'LEASED', 'SENT', 'IN_APP_ONLY', 'FAILED')
  ),
  CONSTRAINT member_notification_outbox_attempts_ck CHECK (attempts <= 10),
  CONSTRAINT member_notification_outbox_source_version_ck CHECK (source_version > 0),
  UNIQUE KEY member_notification_outbox_source_uk (
    app_id, user_id, kind, source_type, source_id, source_version
  ),
  KEY member_notification_outbox_due_idx (
    app_id, status, send_at, lease_expires_at, expires_at, id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
