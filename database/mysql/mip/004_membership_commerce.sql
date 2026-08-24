CREATE TABLE IF NOT EXISTS mip_payment_attempts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_payment_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  prepay_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CREATED',
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_payment_attempts_app_id_uk (app_id, id),
  UNIQUE KEY mip_payment_attempts_request_uk (app_id, order_id, request_hash),
  UNIQUE KEY mip_payment_attempts_provider_id_uk (app_id, provider, provider_payment_id),
  KEY mip_payment_attempts_order_idx (app_id, order_id, created_at DESC, id),
  CONSTRAINT mip_payment_attempts_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_payment_attempts_provider_ck CHECK (provider IN ('WECHAT_PAY', 'TEST')),
  CONSTRAINT mip_payment_attempts_status_ck CHECK (
    status IN ('CREATED', 'PARAMETERS_ISSUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED')
  ),
  CONSTRAINT mip_payment_attempts_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_refunds (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_refund_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  merchant_refund_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  reason VARCHAR(300) NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  refunded_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_refunds_app_id_uk (app_id, id),
  UNIQUE KEY mip_refunds_merchant_no_uk (app_id, merchant_refund_no),
  UNIQUE KEY mip_refunds_idempotency_uk (app_id, order_id, idempotency_key),
  UNIQUE KEY mip_refunds_provider_id_uk (app_id, provider_refund_id),
  KEY mip_refunds_order_idx (app_id, order_id, created_at DESC, id),
  KEY mip_refunds_status_idx (app_id, status, updated_at, id),
  CONSTRAINT mip_refunds_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_refunds_requester_fk FOREIGN KEY (app_id, requested_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_refunds_status_ck CHECK (
    status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT mip_refunds_amount_ck CHECK (amount_cents > 0),
  CONSTRAINT mip_refunds_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_membership_entitlements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason VARCHAR(160) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_membership_entitlements_app_id_uk (app_id, id),
  UNIQUE KEY mip_membership_entitlements_order_uk (app_id, order_id),
  KEY mip_membership_entitlements_user_idx (app_id, user_id, status, ends_at DESC, id),
  CONSTRAINT mip_membership_entitlements_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_entitlements_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_entitlements_plan_fk FOREIGN KEY (app_id, plan_id)
    REFERENCES mip_membership_plans (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_entitlements_status_ck CHECK (
    status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED')
  ),
  CONSTRAINT mip_membership_entitlements_window_ck CHECK (ends_at > starts_at),
  CONSTRAINT mip_membership_entitlements_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_membership_attributions (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entitlement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invited_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  locked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, entitlement_id),
  KEY mip_membership_attributions_inviter_idx (app_id, invited_by_user_id, locked_at DESC),
  CONSTRAINT mip_membership_attributions_entitlement_fk FOREIGN KEY (app_id, entitlement_id)
    REFERENCES mip_membership_entitlements (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_attributions_inviter_fk FOREIGN KEY (app_id, invited_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_attributions_source_ck CHECK (
    (source_type = 'PLATFORM' AND invited_by_user_id IS NULL)
    OR (source_type = 'USER' AND invited_by_user_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_payment_callbacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  callback_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  callback_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verification_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  processing_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RECEIVED',
  processed_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_payment_callbacks_key_uk (app_id, callback_type, callback_key),
  KEY mip_payment_callbacks_status_idx (app_id, processing_status, created_at, id),
  CONSTRAINT mip_payment_callbacks_type_ck CHECK (callback_type IN ('PAYMENT', 'REFUND')),
  CONSTRAINT mip_payment_callbacks_verification_ck CHECK (verification_status IN ('VERIFIED', 'REJECTED')),
  CONSTRAINT mip_payment_callbacks_processing_ck CHECK (
    processing_status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
