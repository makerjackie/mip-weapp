CREATE TABLE IF NOT EXISTS mip_profile_card_templates (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  style_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(60) NOT NULL,
  required_fields_json JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, style_key),
  CONSTRAINT mip_profile_card_template_style_ck CHECK (style_key IN ('PINK', 'BLUE', 'WHITE', 'YELLOW')),
  CONSTRAINT mip_profile_card_template_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS mip_profile_card_moderation (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  reason VARCHAR(500) NOT NULL DEFAULT '',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  CONSTRAINT mip_profile_card_moderation_user_fk FOREIGN KEY (app_id, user_id) REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_profile_card_moderation_status_ck CHECK (status IN ('ACTIVE', 'TAKEN_DOWN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS mip_profile_card_history (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_version BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id, profile_version),
  CONSTRAINT mip_profile_card_history_user_fk FOREIGN KEY (app_id, user_id) REFERENCES mip_users (app_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO mip_profile_card_templates (app_id, style_key, name, required_fields_json, sort_order)
SELECT apps.app_id, styles.style_key, styles.name, JSON_ARRAY('name'), styles.sort_order
FROM (SELECT DISTINCT app_id FROM mip_users) apps
CROSS JOIN (SELECT 'PINK' AS style_key, '粉色名片' AS name, 0 AS sort_order UNION ALL SELECT 'BLUE', '蓝色名片', 1 UNION ALL SELECT 'WHITE', '白色名片', 2 UNION ALL SELECT 'YELLOW', '黄色名片', 3) styles;
INSERT INTO mip_profile_card_history (app_id, user_id, profile_version, snapshot_json)
SELECT p.app_id, p.user_id, p.version,
  JSON_OBJECT('nickname', p.nickname, 'realName', p.real_name, 'headline', p.headline,
    'companies', p.companies_json, 'organizations', p.organizations_json, 'identityStatus', p.identity_status,
    'avatarAssetId', p.avatar_asset_id, 'visibility', p.visibility_json)
FROM mip_profiles p JOIN mip_users u ON u.app_id = p.app_id AND u.id = p.user_id WHERE u.status = 'ACTIVE';
