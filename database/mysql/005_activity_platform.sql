-- Complete activity platform: richer cards, versioned registration answers,
-- paid reservations, event-scoped managers, moderated albums, follows, and opaque check-in credentials.

ALTER TABLE member_media_assets
  DROP CHECK member_media_assets_kind_ck,
  ADD CONSTRAINT member_media_assets_kind_ck CHECK (
    kind IN ('avatar', 'event-cover', 'event-poster', 'event-photo', 'brand')
  );

ALTER TABLE member_profiles
  ADD COLUMN organization VARCHAR(120) NOT NULL DEFAULT '' AFTER headline,
  ADD COLUMN role_title VARCHAR(120) NOT NULL DEFAULT '' AFTER organization,
  ADD COLUMN industry VARCHAR(120) NOT NULL DEFAULT '' AFTER role_title,
  ADD COLUMN interests JSON NULL AFTER tags,
  ADD COLUMN skills JSON NULL AFTER interests,
  ADD COLUMN profile_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER skills,
  ADD CONSTRAINT member_profiles_version_ck CHECK (profile_version > 0);

UPDATE member_profiles
SET interests = JSON_ARRAY(), skills = JSON_ARRAY()
WHERE interests IS NULL OR skills IS NULL;

ALTER TABLE member_profiles
  MODIFY COLUMN interests JSON NOT NULL,
  MODIFY COLUMN skills JSON NOT NULL;

ALTER TABLE member_events
  ADD COLUMN notices TEXT NOT NULL AFTER description,
  ADD COLUMN registration_schema JSON NULL AFTER notices,
  ADD COLUMN form_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER registration_schema,
  ADD COLUMN album_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER form_version,
  ADD COLUMN album_requires_review TINYINT(1) NOT NULL DEFAULT 1 AFTER album_enabled,
  ADD COLUMN poster_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER cover_asset_id,
  ADD CONSTRAINT member_events_form_version_ck CHECK (form_version > 0),
  ADD CONSTRAINT member_events_poster_fk FOREIGN KEY (poster_asset_id)
    REFERENCES member_media_assets(id) ON DELETE SET NULL;

UPDATE member_events
SET registration_schema = JSON_ARRAY()
WHERE registration_schema IS NULL;

ALTER TABLE member_events
  MODIFY COLUMN registration_schema JSON NOT NULL;

ALTER TABLE member_registrations
  DROP CHECK member_registrations_status_ck,
  ADD COLUMN form_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER source_order_id,
  ADD COLUMN answer_snapshot JSON NULL AFTER form_version,
  ADD CONSTRAINT member_registrations_status_ck CHECK (
    status IN ('REGISTERED', 'CANCELLATION_PENDING', 'CANCELLED', 'ATTENDED')
  ),
  ADD CONSTRAINT member_registrations_form_version_ck CHECK (form_version > 0);

UPDATE member_registrations
SET answer_snapshot = JSON_OBJECT()
WHERE answer_snapshot IS NULL;

ALTER TABLE member_registrations
  MODIFY COLUMN answer_snapshot JSON NOT NULL;

CREATE TABLE IF NOT EXISTS member_follows (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  follower_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  followee_user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, follower_user_id, followee_user_id),
  CONSTRAINT member_follows_self_ck CHECK (follower_user_id <> followee_user_id),
  KEY member_follows_followee_idx (app_id, followee_user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_event_managers (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  assigned_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, event_id, user_id),
  CONSTRAINT member_event_managers_event_fk FOREIGN KEY (event_id)
    REFERENCES member_events(id) ON DELETE CASCADE,
  CONSTRAINT member_event_managers_role_ck CHECK (
    role IN ('EVENT_OWNER', 'EDITOR', 'ROSTER_MANAGER', 'CHECKIN_STAFF', 'ALBUM_MODERATOR')
  ),
  CONSTRAINT member_event_managers_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  KEY member_event_managers_user_idx (app_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_event_reservations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  form_version INT UNSIGNED NOT NULL,
  answer_snapshot JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  converted_at DATETIME(3) NULL,
  released_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_event_reservations_event_fk FOREIGN KEY (event_id)
    REFERENCES member_events(id) ON DELETE RESTRICT,
  CONSTRAINT member_event_reservations_order_fk FOREIGN KEY (order_id)
    REFERENCES member_orders(id) ON DELETE RESTRICT,
  CONSTRAINT member_event_reservations_status_ck CHECK (
    status IN ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED')
  ),
  CONSTRAINT member_event_reservations_form_version_ck CHECK (form_version > 0),
  UNIQUE KEY member_event_reservations_order_uk (app_id, order_id),
  KEY member_event_reservations_capacity_idx (app_id, event_id, status, expires_at),
  KEY member_event_reservations_user_idx (app_id, user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_event_photos (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  media_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caption VARCHAR(300) NOT NULL DEFAULT '',
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING_REVIEW',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  reviewed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_at DATETIME(3) NULL,
  rejection_reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT member_event_photos_event_fk FOREIGN KEY (event_id)
    REFERENCES member_events(id) ON DELETE CASCADE,
  CONSTRAINT member_event_photos_media_fk FOREIGN KEY (media_asset_id)
    REFERENCES member_media_assets(id) ON DELETE RESTRICT,
  CONSTRAINT member_event_photos_status_ck CHECK (
    status IN ('PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'REMOVED')
  ),
  CONSTRAINT member_event_photos_version_ck CHECK (version > 0),
  KEY member_event_photos_feed_idx (app_id, event_id, status, created_at DESC, id),
  KEY member_event_photos_user_idx (app_id, user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS member_checkin_credentials (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT member_checkin_credentials_registration_fk FOREIGN KEY (registration_id)
    REFERENCES member_registrations(id) ON DELETE CASCADE,
  UNIQUE KEY member_checkin_credentials_token_uk (app_id, token_hash),
  KEY member_checkin_credentials_active_idx (app_id, registration_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
