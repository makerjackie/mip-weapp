CREATE TABLE IF NOT EXISTS mip_knowledge_sources (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  source_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  fetch_config_json JSON NOT NULL,
  last_fetched_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_sources_key_uk (app_id, source_key),
  KEY mip_knowledge_sources_status_idx (app_id, status, updated_at DESC, id DESC),
  CONSTRAINT mip_knowledge_sources_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_sources_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_sources_type_ck CHECK (source_type IN ('MANUAL', 'JSON_FEED', 'RSS')),
  CONSTRAINT mip_knowledge_sources_endpoint_ck CHECK (
    (source_type = 'MANUAL' AND endpoint_url IS NULL)
    OR (source_type IN ('JSON_FEED', 'RSS') AND endpoint_url LIKE 'https://%')
  ),
  CONSTRAINT mip_knowledge_sources_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_knowledge_sources_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_knowledge_categories (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  summary VARCHAR(300) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_categories_key_uk (app_id, category_key),
  KEY mip_knowledge_categories_list_idx (app_id, status, sort_order, id),
  CONSTRAINT mip_knowledge_categories_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_categories_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_categories_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_knowledge_categories_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_knowledge_contents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  category_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  body_text MEDIUMTEXT NULL,
  external_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  channel_finder_username VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  channel_feed_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  author_name VARCHAR(100) NULL,
  access_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'FREE',
  source_external_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_published_at DATETIME(3) NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  review_reason VARCHAR(300) NULL,
  reviewed_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_contents_source_external_uk (app_id, source_id, source_external_id),
  KEY mip_knowledge_contents_feed_idx (app_id, status, category_id, published_at DESC, id DESC),
  KEY mip_knowledge_contents_type_idx (app_id, status, content_type, published_at DESC, id DESC),
  KEY mip_knowledge_contents_hash_idx (app_id, source_content_hash, id),
  CONSTRAINT mip_knowledge_contents_source_fk FOREIGN KEY (app_id, source_id)
    REFERENCES mip_knowledge_sources (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_category_fk FOREIGN KEY (app_id, category_id)
    REFERENCES mip_knowledge_categories (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_cover_fk FOREIGN KEY (app_id, cover_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_reviewer_fk FOREIGN KEY (app_id, reviewed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_contents_type_ck CHECK (
    content_type IN ('HOT_NEWS', 'ARTICLE', 'WEB', 'VIDEO', 'PRIVATE_CHANNEL', 'EXPERT_SHARE')
  ),
  CONSTRAINT mip_knowledge_contents_access_ck CHECK (access_type IN ('FREE', 'MEMBER', 'MEMBER_OR_PAID')),
  CONSTRAINT mip_knowledge_contents_status_ck CHECK (
    status IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN')
  ),
  CONSTRAINT mip_knowledge_contents_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'PASSED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_knowledge_contents_delivery_ck CHECK (
    (content_type IN ('ARTICLE', 'HOT_NEWS', 'EXPERT_SHARE') AND body_text IS NOT NULL)
    OR (content_type IN ('WEB', 'VIDEO') AND external_url LIKE 'https://%')
    OR (content_type = 'PRIVATE_CHANNEL'
      AND channel_finder_username IS NOT NULL AND channel_feed_id IS NOT NULL)
  ),
  CONSTRAINT mip_knowledge_contents_source_hash_ck CHECK (
    source_content_hash IS NULL OR source_content_hash REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mip_knowledge_contents_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_knowledge_products (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_stage VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  price_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  unlock_days INT UNSIGNED NULL,
  refund_policy VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BEFORE_ACCESS',
  refund_window_hours INT UNSIGNED NOT NULL DEFAULT 24,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_products_content_stage_uk (app_id, content_id, catalog_stage),
  KEY mip_knowledge_products_catalog_idx (app_id, catalog_stage, status, price_cents, id),
  CONSTRAINT mip_knowledge_products_content_fk FOREIGN KEY (app_id, content_id)
    REFERENCES mip_knowledge_contents (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_products_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_products_stage_ck CHECK (catalog_stage IN ('TEST', 'LIVE')),
  CONSTRAINT mip_knowledge_products_price_ck CHECK (price_cents BETWEEN 1 AND 10000000),
  CONSTRAINT mip_knowledge_products_unlock_ck CHECK (unlock_days IS NULL OR unlock_days BETWEEN 1 AND 3660),
  CONSTRAINT mip_knowledge_products_refund_ck CHECK (
    refund_policy IN ('BEFORE_ACCESS', 'NON_REFUNDABLE') AND refund_window_hours BETWEEN 0 AND 720
  ),
  CONSTRAINT mip_knowledge_products_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_knowledge_products_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE mip_orders
  DROP CHECK mip_orders_type_ck,
  DROP CHECK mip_orders_plan_pair_ck,
  ADD CONSTRAINT mip_orders_type_ck CHECK (order_type IN ('MEMBERSHIP', 'EVENT', 'CONTENT')),
  ADD CONSTRAINT mip_orders_plan_pair_ck CHECK (
    (order_type = 'MEMBERSHIP' AND membership_plan_id IS NOT NULL AND resource_id IS NULL)
    OR (order_type IN ('EVENT', 'CONTENT') AND membership_plan_id IS NULL AND resource_id IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS mip_knowledge_entitlements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  first_accessed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason VARCHAR(80) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_entitlements_order_uk (app_id, order_id),
  KEY mip_knowledge_entitlements_access_idx (app_id, user_id, content_id, status, ends_at, id),
  CONSTRAINT mip_knowledge_entitlements_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_entitlements_content_fk FOREIGN KEY (app_id, content_id)
    REFERENCES mip_knowledge_contents (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_entitlements_product_fk FOREIGN KEY (app_id, product_id)
    REFERENCES mip_knowledge_products (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_entitlements_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_entitlements_status_ck CHECK (status IN ('ACTIVE', 'EXPIRED', 'REFUNDED', 'REVOKED')),
  CONSTRAINT mip_knowledge_entitlements_window_ck CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT mip_knowledge_entitlements_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_content_comment_settings (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comments_enabled TINYINT(1) NOT NULL DEFAULT 1,
  moderation_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AUTO',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, target_type, target_id),
  CONSTRAINT mip_content_comment_settings_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comment_settings_target_ck CHECK (target_type IN ('KNOWLEDGE', 'EVENT', 'OPPORTUNITY')),
  CONSTRAINT mip_content_comment_settings_mode_ck CHECK (moderation_mode IN ('AUTO', 'REVIEW')),
  CONSTRAINT mip_content_comment_settings_flags_ck CHECK (comments_enabled IN (0, 1)),
  CONSTRAINT mip_content_comment_settings_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_content_comments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  author_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parent_comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  body VARCHAR(800) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PASSED',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  edited_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  moderated_at DATETIME(3) NULL,
  moderated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  moderation_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  KEY mip_content_comments_feed_idx (app_id, target_type, target_id, status, created_at DESC, id DESC),
  KEY mip_content_comments_author_idx (app_id, author_user_id, created_at DESC, id DESC),
  CONSTRAINT mip_content_comments_author_fk FOREIGN KEY (app_id, author_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comments_parent_fk FOREIGN KEY (app_id, parent_comment_id)
    REFERENCES mip_content_comments (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comments_moderator_fk FOREIGN KEY (app_id, moderated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comments_target_ck CHECK (target_type IN ('KNOWLEDGE', 'EVENT', 'OPPORTUNITY')),
  CONSTRAINT mip_content_comments_status_ck CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED')),
  CONSTRAINT mip_content_comments_safety_ck CHECK (content_safety_status IN ('PASSED', 'REJECTED')),
  CONSTRAINT mip_content_comments_state_ck CHECK (
    (status = 'PENDING' AND published_at IS NULL AND deleted_at IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'HIDDEN' AND moderated_at IS NOT NULL AND moderated_by_user_id IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'DELETED' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT mip_content_comments_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_content_comment_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reporter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(300) NULL,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  resolution_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_content_comment_reports_request_uk (app_id, reporter_user_id, request_id),
  KEY mip_content_comment_reports_status_idx (app_id, status, created_at DESC, id DESC),
  CONSTRAINT mip_content_comment_reports_comment_fk FOREIGN KEY (app_id, comment_id)
    REFERENCES mip_content_comments (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comment_reports_reporter_fk FOREIGN KEY (app_id, reporter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comment_reports_reviewer_fk FOREIGN KEY (app_id, reviewed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_content_comment_reports_category_ck CHECK (
    category IN ('SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER')
  ),
  CONSTRAINT mip_content_comment_reports_status_ck CHECK (
    status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT mip_content_comment_reports_review_state_ck CHECK (
    (status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND resolution_reason IS NULL)
    OR (status = 'REVIEWING' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NULL)
    OR (status IN ('RESOLVED', 'DISMISSED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution_reason IS NOT NULL)
  ),
  CONSTRAINT mip_content_comment_reports_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_knowledge_ingestion_runs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trigger_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RUNNING',
  fetched_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_ingestion_runs_request_uk (app_id, source_id, idempotency_key),
  KEY mip_knowledge_ingestion_runs_status_idx (app_id, status, started_at DESC, id DESC),
  CONSTRAINT mip_knowledge_ingestion_runs_source_fk FOREIGN KEY (app_id, source_id)
    REFERENCES mip_knowledge_sources (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_runs_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_runs_hash_ck CHECK (request_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT mip_knowledge_ingestion_runs_trigger_ck CHECK (trigger_type IN ('ADMIN', 'WORKER')),
  CONSTRAINT mip_knowledge_ingestion_runs_status_ck CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT mip_knowledge_ingestion_runs_state_ck CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status IN ('COMPLETED', 'FAILED') AND completed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_knowledge_ingestion_items (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_external_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_knowledge_ingestion_items_run_external_uk (app_id, run_id, source_external_id),
  KEY mip_knowledge_ingestion_items_source_idx (app_id, source_id, content_hash, created_at DESC),
  CONSTRAINT mip_knowledge_ingestion_items_run_fk FOREIGN KEY (app_id, run_id)
    REFERENCES mip_knowledge_ingestion_runs (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_items_source_fk FOREIGN KEY (app_id, source_id)
    REFERENCES mip_knowledge_sources (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_items_content_fk FOREIGN KEY (app_id, content_id)
    REFERENCES mip_knowledge_contents (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_knowledge_ingestion_items_hash_ck CHECK (content_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT mip_knowledge_ingestion_items_result_ck CHECK (result IN ('CREATED', 'DUPLICATE', 'REJECTED')),
  CONSTRAINT mip_knowledge_ingestion_items_state_ck CHECK (
    (result = 'CREATED' AND content_id IS NOT NULL AND error_code IS NULL)
    OR (result = 'DUPLICATE' AND content_id IS NOT NULL AND error_code IS NULL)
    OR (result = 'REJECTED' AND content_id IS NULL AND error_code IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
