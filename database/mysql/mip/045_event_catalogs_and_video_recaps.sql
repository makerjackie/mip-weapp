CREATE TABLE IF NOT EXISTS mip_event_types (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  type_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_event_types_key_uk (app_id, type_key),
  KEY mip_event_types_list_idx (app_id, status, sort_order, updated_at DESC, id DESC),
  CONSTRAINT mip_event_types_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_types_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_types_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT mip_event_types_state_ck CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status IN ('ACTIVE', 'INACTIVE') AND archived_at IS NULL)
  ),
  CONSTRAINT mip_event_types_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_tags (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tag_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_event_tags_key_uk (app_id, tag_key),
  KEY mip_event_tags_list_idx (app_id, status, sort_order, updated_at DESC, id DESC),
  CONSTRAINT mip_event_tags_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tags_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tags_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT mip_event_tags_state_ck CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status IN ('ACTIVE', 'INACTIVE') AND archived_at IS NULL)
  ),
  CONSTRAINT mip_event_tags_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_tag_assignments (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  assigned_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  removed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, event_id, tag_id),
  KEY mip_event_tag_assignments_tag_idx (app_id, tag_id, status, updated_at DESC, event_id),
  CONSTRAINT mip_event_tag_assignments_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tag_assignments_tag_fk FOREIGN KEY (app_id, tag_id)
    REFERENCES mip_event_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tag_assignments_assigner_fk FOREIGN KEY (app_id, assigned_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tag_assignments_remover_fk FOREIGN KEY (app_id, removed_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_tag_assignments_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_event_tag_assignments_state_ck CHECK (
    (status = 'ACTIVE' AND removed_by_user_id IS NULL AND removed_at IS NULL)
    OR (status = 'INACTIVE' AND removed_by_user_id IS NOT NULL AND removed_at IS NOT NULL)
  ),
  CONSTRAINT mip_event_tag_assignments_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_event_video_recaps (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(300) NOT NULL DEFAULT '',
  destination_provider VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  finder_user_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feed_id VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activated_at DATETIME(3) NULL,
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  KEY mip_event_video_recaps_list_idx (app_id, status, sort_order, updated_at DESC, id DESC),
  KEY mip_event_video_recaps_event_idx (app_id, event_id, status, sort_order, id),
  CONSTRAINT mip_event_video_recaps_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_video_recaps_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_video_recaps_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_video_recaps_destination_ck CHECK (
    destination_provider = 'WECHAT_CHANNELS'
    AND (
      (destination_kind = 'PROFILE' AND feed_id IS NULL)
      OR (destination_kind = 'ACTIVITY' AND feed_id IS NOT NULL)
    )
  ),
  CONSTRAINT mip_event_video_recaps_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT mip_event_video_recaps_state_ck CHECK (
    (status = 'ACTIVE' AND activated_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'INACTIVE' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT mip_event_video_recaps_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mip_event_types (
  id, app_id, type_key, name, description, sort_order, status, version,
  created_by_user_id, updated_by_user_id, created_at, updated_at
)
SELECT UUID(), event.app_id, event.event_type_key, event.event_type_key, '', 0, 'ACTIVE', 1,
       MIN(event.organizer_user_id), MIN(event.organizer_user_id),
       MIN(event.created_at), MAX(event.updated_at)
FROM mip_events event
WHERE NOT EXISTS (
  SELECT 1
  FROM mip_event_types existing
  WHERE existing.app_id = event.app_id
    AND existing.type_key = event.event_type_key
)
GROUP BY event.app_id, event.event_type_key;

ALTER TABLE mip_events
  ADD KEY mip_events_type_catalog_idx (app_id, event_type_key, status, starts_at, id),
  ADD CONSTRAINT mip_events_type_catalog_fk FOREIGN KEY (app_id, event_type_key)
    REFERENCES mip_event_types (app_id, type_key) ON DELETE RESTRICT ON UPDATE RESTRICT;
