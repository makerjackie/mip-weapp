CREATE TABLE IF NOT EXISTS mip_membership_plans (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_stage VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(500) NULL,
  duration_days INT UNSIGNED NOT NULL,
  price_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  benefits_json JSON NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_membership_plans_app_id_uk (app_id, id),
  UNIQUE KEY mip_membership_plans_key_uk (app_id, catalog_stage, plan_key),
  KEY mip_membership_plans_catalog_idx (app_id, catalog_stage, status, price_cents, id),
  CONSTRAINT mip_membership_plans_stage_ck CHECK (catalog_stage IN ('TEST', 'LIVE')),
  CONSTRAINT mip_membership_plans_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_membership_plans_duration_ck CHECK (duration_days BETWEEN 1 AND 3660),
  CONSTRAINT mip_membership_plans_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  membership_plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  merchant_order_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_transaction_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CREATED',
  product_snapshot_json JSON NOT NULL,
  paid_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_orders_app_id_uk (app_id, id),
  UNIQUE KEY mip_orders_merchant_no_uk (app_id, merchant_order_no),
  UNIQUE KEY mip_orders_provider_transaction_uk (app_id, provider_transaction_id),
  UNIQUE KEY mip_orders_idempotency_uk (app_id, user_id, order_type, idempotency_key),
  KEY mip_orders_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_orders_resource_idx (app_id, order_type, resource_id, status, id),
  KEY mip_orders_status_idx (app_id, status, updated_at, id),
  CONSTRAINT mip_orders_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_orders_plan_fk FOREIGN KEY (app_id, membership_plan_id)
    REFERENCES mip_membership_plans (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_orders_type_ck CHECK (order_type IN ('MEMBERSHIP', 'EVENT')),
  CONSTRAINT mip_orders_plan_pair_ck CHECK (
    (order_type = 'MEMBERSHIP' AND membership_plan_id IS NOT NULL AND resource_id IS NULL)
    OR (order_type = 'EVENT' AND membership_plan_id IS NULL AND resource_id IS NOT NULL)
  ),
  CONSTRAINT mip_orders_status_ck CHECK (
    status IN (
      'CREATED', 'PAYMENT_CREATED', 'PAID', 'FAILED', 'CLOSED',
      'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'
    )
  ),
  CONSTRAINT mip_orders_amount_ck CHECK (amount_cents > 0),
  CONSTRAINT mip_orders_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  organizer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  notices TEXT NULL,
  cover_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_type_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  access_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_policy VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  registration_opens_at DATETIME(3) NULL,
  registration_deadline DATETIME(3) NULL,
  cancellation_deadline DATETIME(3) NULL,
  venue_name VARCHAR(160) NULL,
  address VARCHAR(300) NULL,
  city_name VARCHAR(80) NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  online_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  capacity INT UNSIGNED NULL,
  waitlist_enabled TINYINT(1) NOT NULL DEFAULT 0,
  price_cents INT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  registration_schema_json JSON NOT NULL,
  form_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_at DATETIME(3) NULL,
  unpublished_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_events_app_id_uk (app_id, id),
  KEY mip_events_public_feed_idx (app_id, status, starts_at, id),
  KEY mip_events_branch_feed_idx (app_id, branch_id, status, starts_at, id),
  KEY mip_events_organizer_idx (app_id, organizer_user_id, updated_at DESC, id),
  CONSTRAINT mip_events_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_events_organizer_fk FOREIGN KEY (app_id, organizer_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_events_cover_fk FOREIGN KEY (app_id, cover_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_events_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND branch_id IS NULL)
    OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT mip_events_mode_ck CHECK (event_mode IN ('OFFLINE', 'ONLINE', 'HYBRID')),
  CONSTRAINT mip_events_access_ck CHECK (access_type IN ('FREE', 'MEMBER_INCLUDED', 'PAID')),
  CONSTRAINT mip_events_registration_policy_ck CHECK (registration_policy IN ('AUTO', 'APPROVAL')),
  CONSTRAINT mip_events_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED')
  ),
  CONSTRAINT mip_events_content_safety_ck CHECK (
    content_safety_status IN ('PENDING', 'PASSED', 'REJECTED', 'ERROR')
  ),
  CONSTRAINT mip_events_time_ck CHECK (
    ends_at > starts_at
    AND (registration_opens_at IS NULL OR registration_opens_at < starts_at)
    AND (registration_deadline IS NULL OR registration_deadline <= starts_at)
    AND (cancellation_deadline IS NULL OR cancellation_deadline <= starts_at)
  ),
  CONSTRAINT mip_events_delivery_ck CHECK (
    (event_mode = 'OFFLINE' AND online_url IS NULL AND venue_name IS NOT NULL)
    OR (event_mode = 'ONLINE' AND online_url LIKE 'https://%')
    OR (event_mode = 'HYBRID' AND online_url LIKE 'https://%' AND venue_name IS NOT NULL)
  ),
  CONSTRAINT mip_events_pricing_ck CHECK (
    (access_type = 'PAID' AND price_cents > 0 AND registration_policy = 'AUTO' AND waitlist_enabled = 0)
    OR (access_type IN ('FREE', 'MEMBER_INCLUDED') AND price_cents = 0)
  ),
  CONSTRAINT mip_events_capacity_ck CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT mip_events_waitlist_ck CHECK (waitlist_enabled IN (0, 1)),
  CONSTRAINT mip_events_version_ck CHECK (form_version >= 1 AND version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_changes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  change_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  summary VARCHAR(300) NOT NULL,
  changed_fields_json JSON NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_changes_version_uk (app_id, event_id, source_version),
  KEY mip_event_changes_list_idx (app_id, event_id, created_at DESC, id DESC),
  CONSTRAINT mip_event_changes_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_changes_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_changes_type_ck CHECK (
    change_type IN ('CREATED', 'CONTENT', 'SCHEDULE', 'LOCATION', 'RULES', 'STATUS')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_seat_holds (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_seat_holds_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_seat_holds_order_uk (app_id, order_id),
  KEY mip_event_seat_holds_capacity_idx (app_id, event_id, status, expires_at, id),
  KEY mip_event_seat_holds_user_idx (app_id, user_id, status, created_at DESC, id),
  CONSTRAINT mip_event_seat_holds_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_seat_holds_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_seat_holds_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_seat_holds_status_ck CHECK (
    status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_registrations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  answers_json JSON NOT NULL,
  form_version BIGINT UNSIGNED NOT NULL,
  share_profile TINYINT(1) NOT NULL DEFAULT 0,
  ticket_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  waitlisted_at DATETIME(3) NULL,
  registered_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  cancellation_reason VARCHAR(300) NULL,
  cancelled_by_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_registrations_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_registrations_user_uk (app_id, event_id, user_id),
  UNIQUE KEY mip_event_registrations_order_uk (app_id, order_id),
  KEY mip_event_registrations_roster_idx (app_id, event_id, status, registered_at DESC, id DESC),
  KEY mip_event_registrations_user_idx (app_id, user_id, updated_at DESC, id DESC),
  CONSTRAINT mip_event_registrations_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_registrations_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_registrations_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_registrations_status_ck CHECK (
    status IN ('PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED', 'CANCELLATION_PENDING', 'CANCELLED', 'REJECTED', 'ATTENDED')
  ),
  CONSTRAINT mip_event_registrations_share_ck CHECK (share_profile IN (0, 1)),
  CONSTRAINT mip_event_registrations_version_ck CHECK (form_version >= 1 AND version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_invitation_attributions (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  guest_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inviter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, registration_id),
  KEY mip_event_invitation_attributions_event_idx (app_id, event_id, captured_at DESC, registration_id),
  CONSTRAINT mip_event_invitation_attributions_registration_fk FOREIGN KEY (app_id, registration_id)
    REFERENCES mip_event_registrations (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_attributions_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_attributions_guest_fk FOREIGN KEY (app_id, guest_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_attributions_inviter_fk FOREIGN KEY (app_id, inviter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_invitation_attributions_source_ck CHECK (
    (source_type = 'PLATFORM' AND inviter_user_id IS NULL)
    OR (source_type = 'USER' AND inviter_user_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_checkin_credentials (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valid_from DATETIME(3) NOT NULL,
  valid_until DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_checkin_credentials_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_checkin_credentials_token_uk (app_id, token_hash),
  KEY mip_event_checkin_credentials_event_idx (app_id, event_id, status, valid_until, id),
  CONSTRAINT mip_event_checkin_credentials_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_credentials_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_credentials_mode_ck CHECK (mode IN ('STATIC', 'ROTATING')),
  CONSTRAINT mip_event_checkin_credentials_status_ck CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT mip_event_checkin_credentials_time_ck CHECK (valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_checkins (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credential_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  checked_in_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  revoked_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revoke_reason VARCHAR(120) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_checkins_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_checkins_registration_uk (app_id, registration_id),
  KEY mip_event_checkins_event_idx (app_id, event_id, status, checked_in_at DESC, id),
  CONSTRAINT mip_event_checkins_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkins_registration_fk FOREIGN KEY (app_id, registration_id)
    REFERENCES mip_event_registrations (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkins_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkins_credential_fk FOREIGN KEY (app_id, credential_id)
    REFERENCES mip_event_checkin_credentials (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkins_revoker_fk FOREIGN KEY (app_id, revoked_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkins_source_ck CHECK (source IN ('USER_SCAN', 'ADMIN')),
  CONSTRAINT mip_event_checkins_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT mip_event_checkins_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_hearts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_hearts_voter_uk (app_id, event_id, voter_user_id),
  KEY mip_event_hearts_target_idx (app_id, event_id, target_user_id, status, id),
  CONSTRAINT mip_event_hearts_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_hearts_voter_fk FOREIGN KEY (app_id, voter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_hearts_target_fk FOREIGN KEY (app_id, target_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_hearts_status_ck CHECK (
    (status = 'ACTIVE' AND target_user_id IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND target_user_id IS NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT mip_event_hearts_self_ck CHECK (target_user_id IS NULL OR voter_user_id <> target_user_id),
  CONSTRAINT mip_event_hearts_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_feedback (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rating TINYINT UNSIGNED NULL,
  body VARCHAR(2000) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_feedback_user_uk (app_id, event_id, user_id),
  KEY mip_event_feedback_admin_idx (app_id, event_id, submitted_at DESC, id),
  CONSTRAINT mip_event_feedback_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_feedback_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_feedback_rating_ck CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT mip_event_feedback_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
