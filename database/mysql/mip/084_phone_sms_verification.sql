CREATE TABLE IF NOT EXISTS mip_phone_sms_challenges (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phone_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_phone_sms_challenges_scope_uk (app_id, id),
  KEY mip_phone_sms_challenges_user_idx (app_id, user_id, status, created_at),
  CONSTRAINT mip_phone_sms_challenges_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_phone_sms_challenges_status_ck CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'EXPIRED', 'CONSUMED')),
  CONSTRAINT mip_phone_sms_challenges_attempts_ck CHECK (attempts <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_phone_sms_rate_limits (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_sent_at DATETIME(3) NULL,
  hour_started_at DATETIME(3) NOT NULL,
  hour_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  day_started_at DATETIME(3) NOT NULL,
  day_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, subject_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
