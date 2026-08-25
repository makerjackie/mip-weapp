CREATE TABLE IF NOT EXISTS mip_message_delivery_reviews (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workflow_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  claimed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  claimed_at DATETIME(3) NULL,
  claim_expires_at DATETIME(3) NULL,
  resolution_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution_note VARCHAR(500) NULL,
  evidence_reference VARCHAR(300) NULL,
  resolved_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolved_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_message_delivery_reviews_source_uk (app_id, source_type, source_id),
  KEY mip_message_delivery_reviews_workflow_idx (
    app_id, workflow_status, claim_expires_at, updated_at DESC, id DESC
  ),
  KEY mip_message_delivery_reviews_claimed_by_idx (app_id, claimed_by_user_id, updated_at DESC),
  KEY mip_message_delivery_reviews_resolved_by_idx (app_id, resolved_by_user_id, updated_at DESC),
  KEY mip_message_delivery_reviews_scope_idx (app_id, scope_type, scope_id, updated_at DESC),
  CONSTRAINT mip_message_delivery_reviews_claimed_by_fk FOREIGN KEY (app_id, claimed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_delivery_reviews_resolved_by_fk FOREIGN KEY (app_id, resolved_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_delivery_reviews_branch_fk FOREIGN KEY (app_id, scope_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_message_delivery_reviews_source_ck CHECK (
    source_type IN ('CAMPAIGN_DISPATCH', 'DELIVERY_TASK')
  ),
  CONSTRAINT mip_message_delivery_reviews_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND scope_id IS NULL)
    OR (scope_type = 'BRANCH' AND scope_id IS NOT NULL)
  ),
  CONSTRAINT mip_message_delivery_reviews_evidence_ck CHECK (
    evidence_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_message_delivery_reviews_workflow_ck CHECK (
    workflow_status IN ('OPEN', 'CLAIMED', 'RESOLVED')
  ),
  CONSTRAINT mip_message_delivery_reviews_version_ck CHECK (version >= 1),
  CONSTRAINT mip_message_delivery_reviews_resolution_ck CHECK (
    resolution_code IS NULL
    OR resolution_code IN ('AUTO_CONVERGED', 'TERMINAL_ACCEPTED', 'UNKNOWN_NO_REPLAY')
  ),
  CONSTRAINT mip_message_delivery_reviews_state_ck CHECK (
    (
      workflow_status = 'OPEN'
      AND claimed_by_user_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND resolution_code IS NULL AND resolution_note IS NULL AND evidence_reference IS NULL
      AND resolved_by_user_id IS NULL AND resolved_at IS NULL
    )
    OR (
      workflow_status = 'CLAIMED'
      AND claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
      AND resolution_code IS NULL AND resolution_note IS NULL AND evidence_reference IS NULL
      AND resolved_by_user_id IS NULL AND resolved_at IS NULL
    )
    OR (
      workflow_status = 'RESOLVED'
      AND claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NULL
      AND resolution_code IS NOT NULL AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL
      AND (
        resolution_code <> 'UNKNOWN_NO_REPLAY'
        OR (resolution_note IS NOT NULL AND CHAR_LENGTH(TRIM(resolution_note)) BETWEEN 1 AND 500)
      )
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
