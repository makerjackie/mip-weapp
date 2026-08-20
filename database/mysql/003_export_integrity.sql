-- Append-only integrity for export tickets, mutation idempotency, and app-scoped FKs.
-- Does not modify 001/002 locked SQL. Requires 001+002 objects already present.

-- Parent tables need (app_id, id) uniqueness before composite FKs can reference them.
ALTER TABLE member_media_assets
  ADD UNIQUE KEY member_media_assets_app_id_uk (app_id, id);

ALTER TABLE member_events
  ADD UNIQUE KEY member_events_app_id_uk (app_id, id);

ALTER TABLE member_orders
  ADD UNIQUE KEY member_orders_app_id_uk (app_id, id);

ALTER TABLE member_registrations
  ADD UNIQUE KEY member_registrations_app_id_uk (app_id, id);

-- Replace single-column FKs with app-scoped composite FKs for this slice's tables.
-- app_id is NOT NULL on child rows, so ON DELETE SET NULL is illegal for composite FKs
-- that include app_id (MySQL would try to null the whole referencing tuple).
-- Prefer RESTRICT: application must explicitly unbind avatar/cover before deleting media.
ALTER TABLE member_profiles
  DROP FOREIGN KEY member_profiles_avatar_fk,
  ADD CONSTRAINT member_profiles_avatar_app_fk
    FOREIGN KEY (app_id, avatar_asset_id)
    REFERENCES member_media_assets (app_id, id)
    ON DELETE RESTRICT;

ALTER TABLE member_events
  DROP FOREIGN KEY member_events_cover_fk,
  ADD CONSTRAINT member_events_cover_app_fk
    FOREIGN KEY (app_id, cover_asset_id)
    REFERENCES member_media_assets (app_id, id)
    ON DELETE RESTRICT;

ALTER TABLE member_registrations
  DROP FOREIGN KEY member_registrations_event_fk,
  DROP FOREIGN KEY member_registrations_order_fk,
  ADD CONSTRAINT member_registrations_event_app_fk
    FOREIGN KEY (app_id, event_id)
    REFERENCES member_events (app_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT member_registrations_order_app_fk
    FOREIGN KEY (app_id, source_order_id)
    REFERENCES member_orders (app_id, id)
    ON DELETE RESTRICT;

ALTER TABLE member_entitlements
  DROP FOREIGN KEY member_entitlements_source_order_fk,
  ADD CONSTRAINT member_entitlements_source_order_app_fk
    FOREIGN KEY (app_id, source_order_id)
    REFERENCES member_orders (app_id, id)
    ON DELETE RESTRICT;

ALTER TABLE member_refunds
  DROP FOREIGN KEY member_refunds_order_fk,
  ADD CONSTRAINT member_refunds_order_app_fk
    FOREIGN KEY (app_id, order_id)
    REFERENCES member_orders (app_id, id)
    ON DELETE RESTRICT;

-- One-time export download tickets. Raw token is never stored — only token_hash.
-- file_id stores the full CloudBase cloud:// fileID; object_key is the app-scoped path.
-- RESERVED is a short lease before external object IO; CONSUMED is terminal success.
CREATE TABLE IF NOT EXISTS member_export_tickets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_id VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_bytes INT UNSIGNED NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  row_count INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  reserved_until DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_export_tickets_status_ck CHECK (
    status IN ('ACTIVE', 'RESERVED', 'CONSUMED', 'ORPHAN', 'EXPIRED')
  ),
  CONSTRAINT member_export_tickets_version_ck CHECK (version > 0),
  CONSTRAINT member_export_tickets_token_ck CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT member_export_tickets_sha_ck CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT member_export_tickets_bytes_ck CHECK (content_bytes > 0),
  CONSTRAINT member_export_tickets_event_app_fk
    FOREIGN KEY (app_id, event_id) REFERENCES member_events (app_id, id) ON DELETE RESTRICT,
  UNIQUE KEY member_export_tickets_token_uk (app_id, token_hash),
  KEY member_export_tickets_event_idx (app_id, event_id, created_at DESC),
  KEY member_export_tickets_status_idx (app_id, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Server-side mutation idempotency for check-in / undo (same key + same payload replays).
CREATE TABLE IF NOT EXISTS member_mutation_idempotency (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, scope, idempotency_key),
  CONSTRAINT member_mutation_idempotency_scope_ck CHECK (
    scope IN ('checkin', 'undo_checkin')
  ),
  CONSTRAINT member_mutation_idempotency_hash_ck CHECK (payload_hash REGEXP '^[0-9a-f]{64}$'),
  KEY member_mutation_idempotency_resource_idx (app_id, resource_type, resource_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
