CREATE TABLE IF NOT EXISTS mip_message_campaign_dispatches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SCHEDULED',
  scheduled_for DATETIME(3) NOT NULL,
  available_at DATETIME(3) NOT NULL,
  scheduled_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cancelled_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancelled_at DATETIME(3) NULL,
  cancellation_reason VARCHAR(300) NULL,
  completed_at DATETIME(3) NULL,
  idempotency_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_expires_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NOT_ATTEMPTED',
  retry_disposition VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RETRIABLE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_message_campaign_dispatches_app_id_uk (app_id, id),
  UNIQUE KEY mip_message_campaign_dispatches_campaign_uk (app_id, campaign_id, id),
  UNIQUE KEY mip_message_campaign_dispatches_request_uk (
    app_id, scheduled_by_user_id, idempotency_key
  ),
  KEY mip_message_campaign_dispatches_due_idx (
    app_id, status, retry_disposition, available_at, scheduled_for, lease_expires_at, id
  ),
  KEY mip_message_campaign_dispatches_campaign_idx (
    app_id, campaign_id, created_at DESC, id DESC
  ),
  KEY mip_message_campaign_dispatches_canceller_idx (app_id, cancelled_by_user_id),
  CONSTRAINT mip_message_campaign_dispatches_campaign_fk FOREIGN KEY (app_id, campaign_id)
    REFERENCES mip_message_campaigns (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_dispatches_scheduler_fk FOREIGN KEY (app_id, scheduled_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_dispatches_canceller_fk FOREIGN KEY (app_id, cancelled_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_campaign_dispatches_status_ck CHECK (
    status IN ('SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT mip_message_campaign_dispatches_outcome_ck CHECK (
    last_outcome IN ('NOT_ATTEMPTED', 'SUCCEEDED', 'KNOWN_FAILED', 'UNKNOWN')
  ),
  CONSTRAINT mip_message_campaign_dispatches_retry_ck CHECK (
    retry_disposition IN ('RETRIABLE', 'TERMINAL', 'MANUAL_REVIEW')
  ),
  CONSTRAINT mip_message_campaign_dispatches_attempts_ck CHECK (attempts <= 5),
  CONSTRAINT mip_message_campaign_dispatches_version_ck CHECK (version >= 1),
  CONSTRAINT mip_message_campaign_dispatches_state_ck CHECK (
    (
      status = 'SCHEDULED'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NULL AND cancelled_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL
      AND last_error_code IS NULL
      AND last_outcome = 'NOT_ATTEMPTED' AND retry_disposition = 'RETRIABLE'
    )
    OR (
      status = 'PROCESSING'
      AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL AND cancelled_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL
      AND last_outcome = 'UNKNOWN' AND retry_disposition = 'MANUAL_REVIEW'
    )
    OR (
      status = 'COMPLETED'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL AND cancelled_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL
      AND last_error_code IS NULL
      AND last_outcome = 'SUCCEEDED' AND retry_disposition = 'TERMINAL'
    )
    OR (
      status = 'FAILED'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NULL AND cancelled_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL
      AND last_error_code IS NOT NULL
      AND (
        (last_outcome = 'NOT_ATTEMPTED' AND retry_disposition = 'RETRIABLE' AND attempts < 5)
        OR (last_outcome = 'NOT_ATTEMPTED' AND retry_disposition = 'TERMINAL')
        OR (last_outcome = 'KNOWN_FAILED' AND retry_disposition = 'RETRIABLE' AND attempts < 5)
        OR (last_outcome = 'KNOWN_FAILED' AND retry_disposition = 'TERMINAL')
        OR (last_outcome = 'UNKNOWN' AND retry_disposition = 'MANUAL_REVIEW')
      )
    )
    OR (
      status = 'CANCELLED'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NULL AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND retry_disposition IN ('TERMINAL', 'MANUAL_REVIEW')
      AND last_outcome IN ('NOT_ATTEMPTED', 'KNOWN_FAILED', 'UNKNOWN')
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE mip_message_campaigns
  ADD COLUMN active_dispatch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER publish_request_hash,
  ADD UNIQUE KEY mip_message_campaigns_active_dispatch_uk (app_id, active_dispatch_id),
  ADD KEY mip_message_campaigns_active_dispatch_fk_idx (app_id, id, active_dispatch_id),
  ADD CONSTRAINT mip_message_campaigns_active_dispatch_fk FOREIGN KEY (
    app_id, id, active_dispatch_id
  ) REFERENCES mip_message_campaign_dispatches (
    app_id, campaign_id, id
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_message_campaigns_active_dispatch_ck CHECK (
    active_dispatch_id IS NULL OR status = 'READY'
  );

ALTER TABLE mip_delivery_tasks
  ADD COLUMN last_outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NOT_ATTEMPTED' AFTER last_error_code,
  ADD COLUMN retry_disposition VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RETRIABLE' AFTER last_outcome,
  ADD COLUMN outcome_updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER retry_disposition;

UPDATE mip_delivery_tasks
SET last_outcome = CASE status
      WHEN 'PENDING' THEN 'NOT_ATTEMPTED'
      WHEN 'DELIVERED' THEN 'SUCCEEDED'
      ELSE 'UNKNOWN'
    END,
    retry_disposition = CASE status
      WHEN 'PENDING' THEN 'RETRIABLE'
      WHEN 'DELIVERED' THEN 'TERMINAL'
      ELSE 'MANUAL_REVIEW'
    END,
    outcome_updated_at = UTC_TIMESTAMP(3);

ALTER TABLE mip_delivery_tasks
  ADD KEY mip_delivery_tasks_safe_retry_idx (
    app_id, status, retry_disposition, last_outcome, available_at, id
  ),
  ADD CONSTRAINT mip_delivery_tasks_outcome_ck CHECK (
    last_outcome IN ('NOT_ATTEMPTED', 'SUCCEEDED', 'KNOWN_FAILED', 'UNKNOWN')
  ),
  ADD CONSTRAINT mip_delivery_tasks_retry_ck CHECK (
    retry_disposition IN ('RETRIABLE', 'TERMINAL', 'MANUAL_REVIEW')
  ),
  ADD CONSTRAINT mip_delivery_tasks_attempts_ck CHECK (attempts <= 5),
  ADD CONSTRAINT mip_delivery_tasks_outcome_state_ck CHECK (
    (status = 'PENDING' AND last_outcome = 'NOT_ATTEMPTED' AND retry_disposition = 'RETRIABLE')
    OR (status = 'PROCESSING' AND last_outcome = 'UNKNOWN' AND retry_disposition = 'MANUAL_REVIEW')
    OR (
      status = 'FAILED'
      AND (
        (last_outcome IN ('NOT_ATTEMPTED', 'KNOWN_FAILED') AND retry_disposition = 'RETRIABLE')
        OR (last_outcome = 'UNKNOWN' AND retry_disposition = 'MANUAL_REVIEW')
      )
    )
    OR (status = 'DELIVERED' AND last_outcome = 'SUCCEEDED' AND retry_disposition = 'TERMINAL')
    OR (
      status = 'CANCELLED'
      AND (
        (last_outcome IN ('NOT_ATTEMPTED', 'KNOWN_FAILED') AND retry_disposition = 'TERMINAL')
        OR (last_outcome = 'UNKNOWN' AND retry_disposition = 'MANUAL_REVIEW')
      )
    )
  );
