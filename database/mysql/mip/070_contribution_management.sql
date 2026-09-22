-- M06: Create contribution rules, transactions, and reversals for the
-- contribution management subsystem.

CREATE TABLE IF NOT EXISTS mip_contribution_rules (
  rule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  behavior VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_exp INT NOT NULL DEFAULT 0,
  reward_limit INT NULL,
  scope_servers JSON NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (rule_id),
  KEY mip_contribution_rules_behavior_idx (behavior, status, effective_from),
  KEY mip_contribution_rules_status_idx (status, effective_from, effective_to),
  CONSTRAINT mip_contribution_rules_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_contribution_rules_version_ck CHECK (version >= 1),
  CONSTRAINT mip_contribution_rules_effective_ck CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_contribution_transactions (
  txn_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  behavior VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  server_id BIGINT UNSIGNED NULL,
  delta_value INT NOT NULL,
  balance_after INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (txn_no),
  KEY mip_contribution_transactions_user_idx (user_id, created_at),
  KEY mip_contribution_transactions_behavior_idx (behavior, created_at),
  CONSTRAINT mip_contribution_transactions_delta_ck CHECK (delta_value <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_contribution_reversals (
  reversal_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_txn_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reversal_value INT NOT NULL,
  reason VARCHAR(500) NULL,
  reversed_by BIGINT UNSIGNED NULL,
  reversed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reversal_no),
  KEY mip_contribution_reversals_original_idx (original_txn_no, reversed_at),
  CONSTRAINT mip_contribution_reversals_value_ck CHECK (reversal_value <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
