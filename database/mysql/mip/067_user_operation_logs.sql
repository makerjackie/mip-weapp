-- M04: Create mip_user_operation_logs for tracking admin operations on users.

CREATE TABLE IF NOT EXISTS mip_user_operation_logs (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  summary VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (log_id),
  KEY mip_user_operation_logs_user_idx (user_id, created_at),
  KEY mip_user_operation_logs_operator_idx (operator_id, created_at),
  KEY mip_user_operation_logs_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
