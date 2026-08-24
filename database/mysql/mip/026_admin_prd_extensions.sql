ALTER TABLE mip_opportunities
  ADD COLUMN deadline_at DATETIME(3) NULL AFTER published_at,
  ADD KEY mip_opportunities_deadline_idx (app_id, status, deadline_at, id);

ALTER TABLE mip_growth_levels
  ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER minimum_experience,
  ADD COLUMN display_badge VARCHAR(80) NOT NULL DEFAULT '' AFTER name,
  ADD KEY mip_growth_levels_sort_idx (app_id, status, sort_order, id);

UPDATE mip_growth_levels
SET sort_order = LEAST(minimum_experience, 4294967295)
WHERE sort_order = 0 AND minimum_experience > 0;

CREATE TABLE IF NOT EXISTS mip_growth_benefits (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(600) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_growth_benefits_app_id_uk (app_id, id),
  KEY mip_growth_benefits_list_idx (app_id, status, sort_order, id),
  CONSTRAINT mip_growth_benefits_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_growth_benefits_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_growth_level_benefits (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  level_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  benefit_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, level_id, benefit_id),
  KEY mip_growth_level_benefits_benefit_idx (app_id, benefit_id, level_id),
  CONSTRAINT mip_growth_level_benefits_level_fk FOREIGN KEY (app_id, level_id)
    REFERENCES mip_growth_levels (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_growth_level_benefits_benefit_fk FOREIGN KEY (app_id, benefit_id)
    REFERENCES mip_growth_benefits (app_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE mip_events
  ADD COLUMN archived_at DATETIME(3) NULL AFTER ended_at,
  ADD COLUMN archived_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER archived_at,
  ADD COLUMN archive_reason VARCHAR(300) NULL AFTER archived_by_user_id,
  ADD CONSTRAINT mip_events_archiver_fk FOREIGN KEY (app_id, archived_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  DROP CHECK mip_events_status_ck,
  ADD CONSTRAINT mip_events_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED')
  ),
  ADD CONSTRAINT mip_events_archive_ck CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL
      AND archive_reason IS NOT NULL AND CHAR_LENGTH(TRIM(archive_reason)) > 0)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL AND archived_by_user_id IS NULL AND archive_reason IS NULL)
  );

ALTER TABLE mip_admin_export_tickets
  DROP CHECK mip_admin_export_tickets_type_ck,
  ADD CONSTRAINT mip_admin_export_tickets_type_ck CHECK (
    export_type IN (
      'USERS', 'EVENT_ROSTER', 'EVENT_ROSTER_ALL', 'EVENT_ORDERS', 'ORDERS',
      'GROWTH_ENTRIES', 'OPPORTUNITIES'
    )
  );
