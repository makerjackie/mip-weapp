-- M06: Create mip_entitlement_transactions for tracking membership entitlement grants.

CREATE TABLE IF NOT EXISTS mip_entitlement_transactions (
  entitlement_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  entitlement_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entitlement_content JSON NOT NULL,
  related_order_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  grantor BIGINT UNSIGNED NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MANUAL',
  PRIMARY KEY (entitlement_no),
  KEY mip_entitlement_transactions_user_idx (user_id, granted_at),
  KEY mip_entitlement_transactions_type_idx (entitlement_type, granted_at),
  KEY mip_entitlement_transactions_granted_idx (granted_at),
  CONSTRAINT mip_entitlement_transactions_source_ck CHECK (
    source IN ('MANUAL', 'ORDER', 'SYSTEM', 'MIGRATION')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
