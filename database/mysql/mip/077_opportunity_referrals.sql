-- M07/P1: Create mip_opportunity_referral_records for tracking opportunity
-- referral status per user.

CREATE TABLE IF NOT EXISTS mip_opportunity_referral_records (
  referral_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (referral_id),
  KEY mip_opportunity_referral_records_opportunity_idx (opportunity_id, status, created_at),
  KEY mip_opportunity_referral_records_user_idx (user_id, status, created_at),
  CONSTRAINT mip_opportunity_referral_records_status_ck CHECK (
    status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
