CREATE TABLE IF NOT EXISTS mip_membership_chains (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT mip_membership_chains_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_chains_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mip_membership_chains (
  app_id, user_id, version, created_at, updated_at
)
SELECT membership_user.app_id, membership_user.id, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM mip_users membership_user
ON DUPLICATE KEY UPDATE user_id = mip_membership_chains.user_id;

CREATE TABLE IF NOT EXISTS mip_membership_adjustments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  duration_months TINYINT UNSIGNED NOT NULL,
  reason VARCHAR(300) NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_chain_version BIGINT UNSIGNED NOT NULL,
  result_chain_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_membership_adjustments_app_id_uk (app_id, id),
  UNIQUE KEY mip_membership_adjustments_user_id_uk (app_id, user_id, id),
  UNIQUE KEY mip_membership_adjustments_request_uk (app_id, actor_user_id, idempotency_key),
  KEY mip_membership_adjustments_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_membership_adjustments_actor_idx (app_id, actor_user_id, created_at DESC, id),
  CONSTRAINT mip_membership_adjustments_chain_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_membership_chains (app_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_adjustments_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_adjustments_duration_ck CHECK (duration_months IN (1, 3, 6, 12)),
  CONSTRAINT mip_membership_adjustments_reason_ck CHECK (
    CHAR_LENGTH(TRIM(reason)) BETWEEN 1 AND 300
  ),
  CONSTRAINT mip_membership_adjustments_idempotency_ck CHECK (
    CHAR_LENGTH(idempotency_key) BETWEEN 1 AND 128
  ),
  CONSTRAINT mip_membership_adjustments_request_hash_ck CHECK (
    request_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_membership_adjustments_version_ck CHECK (
    expected_chain_version >= 1
    AND result_chain_version = expected_chain_version + 1
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE mip_membership_entitlements
  MODIFY COLUMN order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN source_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'ORDER' AFTER plan_id,
  ADD COLUMN source_adjustment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
    NULL AFTER source_type,
  ADD UNIQUE KEY mip_membership_entitlements_adjustment_uk (app_id, source_adjustment_id),
  ADD KEY mip_membership_entitlements_adjustment_user_idx (
    app_id, user_id, source_adjustment_id
  ),
  ADD CONSTRAINT mip_membership_entitlements_adjustment_fk
    FOREIGN KEY (app_id, user_id, source_adjustment_id)
    REFERENCES mip_membership_adjustments (app_id, user_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_membership_entitlements_source_type_ck CHECK (
    source_type IN ('ORDER', 'ADMIN_ADJUSTMENT')
  ),
  ADD CONSTRAINT mip_membership_entitlements_source_pair_ck CHECK (
    (
      source_type = 'ORDER'
      AND order_id IS NOT NULL
      AND plan_id IS NOT NULL
      AND source_adjustment_id IS NULL
    )
    OR (
      source_type = 'ADMIN_ADJUSTMENT'
      AND order_id IS NULL
      AND plan_id IS NULL
      AND source_adjustment_id IS NOT NULL
    )
  );
