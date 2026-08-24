CREATE TABLE IF NOT EXISTS mip_opportunities (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PLATFORM',
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  title VARCHAR(120) NOT NULL,
  value_summary VARCHAR(240) NOT NULL,
  target_summary VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  city_tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  referral_count INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  moderated_at DATETIME(3) NULL,
  moderated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  moderation_reason VARCHAR(240) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_opportunities_app_id_uk (app_id, id),
  KEY mip_opportunities_public_idx (app_id, status, published_at DESC, id),
  KEY mip_opportunities_owner_idx (app_id, owner_user_id, updated_at DESC, id),
  KEY mip_opportunities_branch_idx (app_id, branch_id, status, published_at DESC, id),
  KEY mip_opportunities_city_idx (app_id, city_tag_id, status, published_at DESC, id),
  FULLTEXT KEY mip_opportunities_search_ft (title, value_summary, target_summary, description),
  CONSTRAINT mip_opportunities_owner_fk FOREIGN KEY (app_id, owner_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunities_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunities_city_fk FOREIGN KEY (app_id, city_tag_id)
    REFERENCES mip_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunities_cover_fk FOREIGN KEY (app_id, cover_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunities_moderator_fk FOREIGN KEY (app_id, moderated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunities_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT mip_opportunities_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED')
  ),
  CONSTRAINT mip_opportunities_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_opportunities_version_ck CHECK (version >= 1),
  CONSTRAINT mip_opportunities_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'ENDED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_roles (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, opportunity_id, role_key),
  KEY mip_opportunity_roles_filter_idx (app_id, role_key, opportunity_id),
  CONSTRAINT mip_opportunity_roles_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE CASCADE,
  CONSTRAINT mip_opportunity_roles_role_ck CHECK (
    role_key IN ('connector', 'business_builder', 'capital_operator', 'strategist', 'visual_designer', 'delivery_lead')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_tags (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, opportunity_id, tag_id, relation),
  KEY mip_opportunity_tags_filter_idx (app_id, relation, tag_id, opportunity_id),
  CONSTRAINT mip_opportunity_tags_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE CASCADE,
  CONSTRAINT mip_opportunity_tags_tag_fk FOREIGN KEY (app_id, tag_id)
    REFERENCES mip_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_tags_relation_ck CHECK (relation IN ('INDUSTRY', 'ABILITY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_referral_intents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  note VARCHAR(240) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_referral_intents_app_id_uk (app_id, id),
  UNIQUE KEY mip_referral_intents_actor_uk (app_id, opportunity_id, actor_user_id),
  KEY mip_referral_intents_opportunity_idx (app_id, opportunity_id, status, activated_at DESC, id),
  KEY mip_referral_intents_actor_idx (app_id, actor_user_id, status, updated_at DESC, id),
  CONSTRAINT mip_referral_intents_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_referral_intents_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_referral_intents_status_ck CHECK (status IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT mip_referral_intents_version_ck CHECK (version >= 1),
  CONSTRAINT mip_referral_intents_time_ck CHECK (
    (status = 'ACTIVE' AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_profile_interests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  source_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_profile_interests_app_id_uk (app_id, id),
  UNIQUE KEY mip_profile_interests_pair_uk (app_id, actor_user_id, target_user_id),
  KEY mip_profile_interests_target_idx (app_id, target_user_id, status, activated_at DESC, id),
  KEY mip_profile_interests_actor_idx (app_id, actor_user_id, status, updated_at DESC, id),
  CONSTRAINT mip_profile_interests_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_profile_interests_target_fk FOREIGN KEY (app_id, target_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_profile_interests_status_ck CHECK (status IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT mip_profile_interests_source_ck CHECK (
    source_type IN ('OPPORTUNITY', 'COOPERATION_CARD', 'SUPER_CASE')
  ),
  CONSTRAINT mip_profile_interests_self_ck CHECK (actor_user_id <> target_user_id),
  CONSTRAINT mip_profile_interests_version_ck CHECK (version >= 1),
  CONSTRAINT mip_profile_interests_time_ck CHECK (
    (status = 'ACTIVE' AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_cooperation_cards (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  positioning VARCHAR(500) NOT NULL,
  target_summary VARCHAR(500) NOT NULL,
  role_fields_json JSON NOT NULL,
  ability_scores_json JSON NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_cooperation_cards_app_id_uk (app_id, id),
  UNIQUE KEY mip_cooperation_cards_owner_role_uk (app_id, owner_user_id, role_key),
  KEY mip_cooperation_cards_public_idx (app_id, status, role_key, published_at DESC, id),
  KEY mip_cooperation_cards_owner_idx (app_id, owner_user_id, updated_at DESC, id),
  CONSTRAINT mip_cooperation_cards_owner_fk FOREIGN KEY (app_id, owner_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_cooperation_cards_role_ck CHECK (
    role_key IN ('connector', 'business_builder', 'capital_operator', 'strategist', 'visual_designer', 'delivery_lead')
  ),
  CONSTRAINT mip_cooperation_cards_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
  ),
  CONSTRAINT mip_cooperation_cards_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_cooperation_cards_version_ck CHECK (version >= 1),
  CONSTRAINT mip_cooperation_cards_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_super_cases (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_name VARCHAR(120) NOT NULL,
  summary VARCHAR(240) NOT NULL,
  started_on DATE NULL,
  ended_on DATE NULL,
  responsibility VARCHAR(500) NOT NULL,
  city_tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  industry_tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  case_type VARCHAR(80) NULL,
  description TEXT NOT NULL,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_super_cases_app_id_uk (app_id, id),
  KEY mip_super_cases_public_idx (app_id, status, published_at DESC, id),
  KEY mip_super_cases_owner_idx (app_id, owner_user_id, updated_at DESC, id),
  KEY mip_super_cases_city_idx (app_id, city_tag_id, status, published_at DESC, id),
  KEY mip_super_cases_industry_idx (app_id, industry_tag_id, status, published_at DESC, id),
  FULLTEXT KEY mip_super_cases_search_ft (project_name, summary, responsibility, description),
  CONSTRAINT mip_super_cases_owner_fk FOREIGN KEY (app_id, owner_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_super_cases_city_fk FOREIGN KEY (app_id, city_tag_id)
    REFERENCES mip_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_super_cases_industry_fk FOREIGN KEY (app_id, industry_tag_id)
    REFERENCES mip_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_super_cases_cover_fk FOREIGN KEY (app_id, cover_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_super_cases_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
  ),
  CONSTRAINT mip_super_cases_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_super_cases_version_ck CHECK (version >= 1),
  CONSTRAINT mip_super_cases_dates_ck CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
  CONSTRAINT mip_super_cases_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_super_case_media (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  super_case_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  caption VARCHAR(160) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, super_case_id, media_asset_id),
  KEY mip_super_case_media_order_idx (app_id, super_case_id, sort_order, media_asset_id),
  CONSTRAINT mip_super_case_media_case_fk FOREIGN KEY (app_id, super_case_id)
    REFERENCES mip_super_cases (app_id, id) ON DELETE CASCADE,
  CONSTRAINT mip_super_case_media_asset_fk FOREIGN KEY (app_id, media_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
