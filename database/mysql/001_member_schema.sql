CREATE TABLE IF NOT EXISTS member_schema_migrations (
  version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_media_assets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_key VARCHAR(128) NOT NULL,
  kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cloud_file_id VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  bytes INT UNSIGNED NOT NULL,
  mime_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alt_text VARCHAR(255) NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provenance VARCHAR(128) NOT NULL,
  content_version INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'READY',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT member_media_assets_kind_ck CHECK (kind IN ('avatar', 'event-cover', 'brand')),
  CONSTRAINT member_media_assets_size_ck CHECK (width > 0 AND height > 0 AND bytes > 0),
  CONSTRAINT member_media_assets_mime_ck CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT member_media_assets_sha_ck CHECK (sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT member_media_assets_version_ck CHECK (content_version > 0),
  CONSTRAINT member_media_assets_status_ck CHECK (status IN ('PROCESSING', 'READY', 'ARCHIVED')),
  UNIQUE KEY member_media_assets_file_uk (app_id, cloud_file_id),
  UNIQUE KEY member_media_assets_key_version_uk (app_id, asset_key, content_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_profiles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  external_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  nickname VARCHAR(80) NOT NULL,
  city VARCHAR(120) NOT NULL DEFAULT '',
  headline VARCHAR(400) NOT NULL DEFAULT '',
  bio TEXT NOT NULL,
  tags JSON NOT NULL,
  avatar_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3) NULL,
  CONSTRAINT member_profiles_status_ck CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DELETED')),
  CONSTRAINT member_profiles_avatar_fk FOREIGN KEY (avatar_asset_id) REFERENCES member_media_assets(id) ON DELETE SET NULL,
  UNIQUE KEY member_profiles_user_uk (app_id, user_id),
  UNIQUE KEY member_profiles_external_uk (app_id, external_key),
  KEY member_profiles_discovery_idx (app_id, status, updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_private_profiles (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phone_number VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  phone_bound_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_plans (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  price_cents INT UNSIGNED NOT NULL,
  duration_days INT UNSIGNED NOT NULL,
  benefits JSON NOT NULL,
  environment VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  CONSTRAINT member_plans_price_ck CHECK (price_cents > 0),
  CONSTRAINT member_plans_duration_ck CHECK (duration_days > 0),
  CONSTRAINT member_plans_environment_ck CHECK (environment IN ('test', 'live')),
  CONSTRAINT member_plans_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  out_trade_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  description VARCHAR(127) NOT NULL,
  duration_days INT UNSIGNED NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  transaction_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  entitlement_start DATETIME(3) NULL,
  entitlement_end DATETIME(3) NULL,
  paid_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_orders_type_ck CHECK (order_type IN ('MEMBERSHIP', 'EVENT')),
  CONSTRAINT member_orders_amount_ck CHECK (amount_cents > 0),
  CONSTRAINT member_orders_currency_ck CHECK (currency = 'CNY'),
  CONSTRAINT member_orders_status_ck CHECK (status IN ('PENDING', 'PAYMENT_CREATED', 'PAID', 'CLOSED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED', 'FAILED')),
  UNIQUE KEY member_orders_idempotency_uk (app_id, user_id, idempotency_key),
  UNIQUE KEY member_orders_trade_uk (app_id, out_trade_no),
  KEY member_orders_user_idx (app_id, user_id, created_at DESC),
  KEY member_orders_status_idx (app_id, status, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_entitlements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  starts_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  source_order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_entitlements_status_ck CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  CONSTRAINT member_entitlements_source_order_fk FOREIGN KEY (source_order_id) REFERENCES member_orders(id) ON DELETE RESTRICT,
  UNIQUE KEY member_entitlements_user_uk (app_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  registration_deadline DATETIME(3) NULL,
  location VARCHAR(255) NOT NULL,
  address VARCHAR(500) NOT NULL DEFAULT '',
  capacity INT UNSIGNED NOT NULL,
  price_cents INT UNSIGNED NOT NULL DEFAULT 0,
  member_free TINYINT(1) NOT NULL DEFAULT 0,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_events_capacity_ck CHECK (capacity > 0),
  CONSTRAINT member_events_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED')),
  CONSTRAINT member_events_cover_fk FOREIGN KEY (cover_asset_id) REFERENCES member_media_assets(id) ON DELETE SET NULL,
  UNIQUE KEY member_events_external_uk (app_id, external_key),
  KEY member_events_feed_idx (app_id, status, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_registrations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REGISTERED',
  source_order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_registrations_status_ck CHECK (status IN ('REGISTERED', 'CANCELLED', 'ATTENDED')),
  CONSTRAINT member_registrations_event_fk FOREIGN KEY (event_id) REFERENCES member_events(id) ON DELETE RESTRICT,
  CONSTRAINT member_registrations_order_fk FOREIGN KEY (source_order_id) REFERENCES member_orders(id) ON DELETE RESTRICT,
  UNIQUE KEY member_registrations_user_event_uk (app_id, event_id, user_id),
  KEY member_registrations_user_idx (app_id, user_id, registered_at DESC),
  KEY member_registrations_event_idx (app_id, event_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_admin_roles (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT member_admin_roles_role_ck CHECK (role IN ('owner', 'manager', 'reviewer', 'support')),
  CONSTRAINT member_admin_roles_status_ck CHECK (status IN ('ACTIVE', 'SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_refunds (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  out_trade_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  out_refund_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REFUND_PENDING',
  refund_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submitted_at DATETIME(3) NULL,
  refunded_at DATETIME(3) NULL,
  requested_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(480) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_refunds_order_fk FOREIGN KEY (order_id) REFERENCES member_orders(id) ON DELETE RESTRICT,
  CONSTRAINT member_refunds_amount_ck CHECK (amount_cents > 0),
  CONSTRAINT member_refunds_currency_ck CHECK (currency = 'CNY'),
  CONSTRAINT member_refunds_status_ck CHECK (status IN ('REFUND_PENDING', 'REFUND_CREATED', 'REFUNDED', 'REFUND_FAILED')),
  UNIQUE KEY member_refunds_no_uk (app_id, out_refund_no),
  UNIQUE KEY member_refunds_order_uk (app_id, order_id),
  KEY member_refunds_status_idx (app_id, status, updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY member_audit_logs_feed_idx (app_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
