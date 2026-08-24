CREATE TABLE IF NOT EXISTS mip_badges (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  badge_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  icon_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  image_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  placeholder_shape VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CIRCLE',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_badges_key_uk (app_id, badge_key),
  KEY mip_badges_list_idx (app_id, status, sort_order, id),
  CONSTRAINT mip_badges_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_badges_shape_ck CHECK (placeholder_shape IN ('CIRCLE', 'DIAMOND', 'HEXAGON')),
  CONSTRAINT mip_badges_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_badges_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_user_badges (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  badge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  award_reason VARCHAR(300) NOT NULL,
  awarded_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  awarded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revoke_reason VARCHAR(300) NULL,
  revoked_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_user_badges_user_badge_uk (app_id, user_id, badge_id),
  KEY mip_user_badges_badge_idx (app_id, badge_id, status, awarded_at DESC, id),
  KEY mip_user_badges_user_idx (app_id, user_id, status, awarded_at DESC, id),
  CONSTRAINT mip_user_badges_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badges_badge_fk FOREIGN KEY (app_id, badge_id)
    REFERENCES mip_badges (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badges_awarder_fk FOREIGN KEY (app_id, awarded_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badges_revoker_fk FOREIGN KEY (app_id, revoked_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badges_status_ck CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT mip_user_badges_revoke_ck CHECK (
    (status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoke_reason IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL
      AND revoke_reason IS NOT NULL AND CHAR_LENGTH(TRIM(revoke_reason)) > 0 AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT mip_user_badges_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_user_badge_profiles (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT mip_user_badge_profiles_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badge_profiles_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_user_badge_equipment (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_no TINYINT UNSIGNED NOT NULL,
  badge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equipped_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id, slot_no),
  UNIQUE KEY mip_user_badge_equipment_badge_uk (app_id, user_id, badge_id),
  CONSTRAINT mip_user_badge_equipment_profile_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_user_badge_profiles (app_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badge_equipment_award_fk FOREIGN KEY (app_id, user_id, badge_id)
    REFERENCES mip_user_badges (app_id, user_id, badge_id) ON DELETE RESTRICT,
  CONSTRAINT mip_user_badge_equipment_slot_ck CHECK (slot_no BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
