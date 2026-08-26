CREATE TABLE IF NOT EXISTS mip_knowledge_ingestion_schedules (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  daily_time CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  timezone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Shanghai',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PAUSED',
  next_run_at DATETIME(3) NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_due_at DATETIME(3) NULL,
  leased_until DATETIME(3) NULL,
  last_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_started_at DATETIME(3) NULL,
  last_completed_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  configured_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_ingestion_schedules_source_uk (app_id, source_id),
  KEY mip_knowledge_ingestion_schedules_due_idx (
    app_id, status, next_run_at, leased_until, id
  ),
  CONSTRAINT mip_knowledge_ingestion_schedules_source_fk FOREIGN KEY (app_id, source_id)
    REFERENCES mip_knowledge_sources (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_schedules_category_fk FOREIGN KEY (app_id, category_id)
    REFERENCES mip_knowledge_categories (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_schedules_run_fk FOREIGN KEY (app_id, last_run_id)
    REFERENCES mip_knowledge_ingestion_runs (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_schedules_configurer_fk FOREIGN KEY (app_id, configured_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_schedules_time_ck CHECK (
    daily_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  CONSTRAINT mip_knowledge_ingestion_schedules_timezone_ck CHECK (
    timezone REGEXP '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)*$'
  ),
  CONSTRAINT mip_knowledge_ingestion_schedules_status_ck CHECK (
    status IN ('ACTIVE', 'PAUSED')
  ),
  CONSTRAINT mip_knowledge_ingestion_schedules_attempt_ck CHECK (attempt_count BETWEEN 0 AND 3),
  CONSTRAINT mip_knowledge_ingestion_schedules_lease_ck CHECK (
    (lease_token IS NULL AND lease_due_at IS NULL AND leased_until IS NULL)
    OR (lease_token IS NOT NULL AND lease_due_at IS NOT NULL AND leased_until IS NOT NULL)
  ),
  CONSTRAINT mip_knowledge_ingestion_schedules_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
