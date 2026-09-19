-- M07/P1: Create mip_opportunity_operation_logs and mip_opportunity_delete_snapshots
-- for opportunity audit trails.

CREATE TABLE IF NOT EXISTS mip_opportunity_operation_logs (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  summary VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (log_id),
  KEY mip_opportunity_operation_logs_opportunity_idx (opportunity_id, created_at),
  KEY mip_opportunity_operation_logs_operator_idx (operator_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_delete_snapshots (
  snapshot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  deleted_by BIGINT UNSIGNED NOT NULL,
  deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (snapshot_id),
  KEY mip_opportunity_delete_snapshots_opportunity_idx (opportunity_id, deleted_at),
  KEY mip_opportunity_delete_snapshots_deleted_by_idx (deleted_by, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
