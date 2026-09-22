-- M06/P2: Create mip_exp_reversals for the experience reversal subsystem (Wave 2).

CREATE TABLE IF NOT EXISTS mip_exp_reversals (
  reversal_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_entry_id BIGINT UNSIGNED NOT NULL,
  original_txn_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reversal_value INT NOT NULL,
  reason VARCHAR(500) NULL,
  reversed_by BIGINT UNSIGNED NULL,
  reversed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reversal_no),
  KEY mip_exp_reversals_original_entry_idx (original_entry_id, reversed_at),
  KEY mip_exp_reversals_original_txn_idx (original_txn_no, reversed_at),
  CONSTRAINT mip_exp_reversals_value_ck CHECK (reversal_value <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
