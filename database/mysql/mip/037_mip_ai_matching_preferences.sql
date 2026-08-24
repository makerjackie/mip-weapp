CREATE TABLE IF NOT EXISTS mip_user_notification_preferences (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_notifications_enabled TINYINT(1) NOT NULL DEFAULT 1,
  opportunity_matching_notifications_enabled TINYINT(1) NOT NULL DEFAULT 1,
  hotspot_notifications_enabled TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT mip_user_notification_preferences_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_notification_preferences_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_user_opportunity_preferences (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  matching_enabled TINYINT(1) NOT NULL DEFAULT 1,
  talent_recommendations_enabled TINYINT(1) NOT NULL DEFAULT 1,
  project_recommendations_enabled TINYINT(1) NOT NULL DEFAULT 1,
  discoverable_for_matching TINYINT(1) NOT NULL DEFAULT 1,
  matching_scope VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PRIMARY_BRANCH',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  KEY mip_user_opportunity_preferences_discovery_idx (
    app_id, discoverable_for_matching, matching_scope, user_id
  ),
  CONSTRAINT mip_user_opportunity_preferences_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_opportunity_preferences_scope_ck CHECK (
    matching_scope IN ('PLATFORM', 'PRIMARY_BRANCH')
  ),
  CONSTRAINT mip_user_opportunity_preferences_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_matching_settings (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  talent_min_score TINYINT UNSIGNED NOT NULL DEFAULT 35,
  project_min_score TINYINT UNSIGNED NOT NULL DEFAULT 30,
  maximum_candidates SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  external_provider_enabled TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, scope_key),
  KEY mip_matching_settings_scope_idx (app_id, scope_type, scope_id),
  CONSTRAINT mip_matching_settings_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_settings_branch_fk FOREIGN KEY (app_id, scope_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_settings_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND scope_id IS NULL AND scope_key = 'PLATFORM')
    OR (scope_type = 'BRANCH' AND scope_id IS NOT NULL AND scope_key = CONCAT('BRANCH:', scope_id))
  ),
  CONSTRAINT mip_matching_settings_score_ck CHECK (
    talent_min_score BETWEEN 0 AND 100 AND project_min_score BETWEEN 0 AND 100
  ),
  CONSTRAINT mip_matching_settings_limit_ck CHECK (maximum_candidates BETWEEN 10 AND 500),
  CONSTRAINT mip_matching_settings_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_matching_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requester_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USER',
  requested_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RUNNING',
  provider_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LOCAL',
  provider_fallback_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  settings_scope_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settings_version BIGINT UNSIGNED NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  result_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  result_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_matching_requests_idempotency_uk (
    app_id, requested_by_user_id, idempotency_key
  ),
  KEY mip_matching_requests_requester_idx (
    app_id, requester_user_id, created_at DESC, id DESC
  ),
  KEY mip_matching_requests_source_idx (
    app_id, source_opportunity_id, created_at DESC, id DESC
  ),
  CONSTRAINT mip_matching_requests_requester_fk FOREIGN KEY (app_id, requester_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_requests_requested_by_fk FOREIGN KEY (app_id, requested_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_requests_source_fk FOREIGN KEY (app_id, source_opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_requests_actor_ck CHECK (requested_by_type IN ('USER', 'ADMIN')),
  CONSTRAINT mip_matching_requests_status_ck CHECK (
    status IN ('RUNNING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT mip_matching_requests_provider_ck CHECK (provider_key IN ('LOCAL', 'EXTERNAL')),
  CONSTRAINT mip_matching_requests_version_ck CHECK (
    settings_version >= 0 AND source_version >= 1 AND result_version >= 1
  ),
  CONSTRAINT mip_matching_requests_state_ck CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_matching_results (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_version BIGINT UNSIGNED NOT NULL,
  candidate_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rank_no SMALLINT UNSIGNED NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  explanation_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, request_id, result_version, candidate_type, candidate_id),
  UNIQUE KEY mip_matching_results_rank_uk (
    app_id, request_id, result_version, candidate_type, rank_no
  ),
  KEY mip_matching_results_candidate_idx (app_id, candidate_type, candidate_id, created_at DESC),
  CONSTRAINT mip_matching_results_request_fk FOREIGN KEY (app_id, request_id)
    REFERENCES mip_matching_requests (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_results_type_ck CHECK (candidate_type IN ('TALENT', 'PROJECT')),
  CONSTRAINT mip_matching_results_score_ck CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT mip_matching_results_rank_ck CHECK (rank_no >= 1),
  CONSTRAINT mip_matching_results_version_ck CHECK (result_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_matching_feedback (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_version BIGINT UNSIGNED NOT NULL,
  candidate_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feedback_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(240) NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_matching_feedback_idempotency_uk (app_id, actor_user_id, idempotency_key),
  KEY mip_matching_feedback_result_idx (
    app_id, request_id, result_version, candidate_type, candidate_id, actor_user_id,
    created_at DESC, id DESC
  ),
  CONSTRAINT mip_matching_feedback_result_fk FOREIGN KEY (
    app_id, request_id, result_version, candidate_type, candidate_id
  ) REFERENCES mip_matching_results (
    app_id, request_id, result_version, candidate_type, candidate_id
  ) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_feedback_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_matching_feedback_type_ck CHECK (
    feedback_type IN ('HELPFUL', 'NOT_RELEVANT', 'CONTACTED', 'DISMISSED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
