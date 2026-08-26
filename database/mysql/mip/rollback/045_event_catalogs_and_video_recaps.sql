-- Structural rollback only. It keeps the existing event_type_key strings, but fails
-- closed when any new catalog metadata, event tag relation, or recap would be lost.
-- Execute this entire rollback in one MySQL session: TEMPORARY tables are session-local.
DROP TEMPORARY TABLE IF EXISTS mip_event_catalogs_rollback_guard;

CREATE TEMPORARY TABLE mip_event_catalogs_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_event_catalogs_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_event_catalogs_rollback_guard (guard_id)
SELECT 1 FROM mip_event_tags LIMIT 1;

INSERT INTO mip_event_catalogs_rollback_guard (guard_id)
SELECT 1 FROM mip_event_tag_assignments LIMIT 1;

INSERT INTO mip_event_catalogs_rollback_guard (guard_id)
SELECT 1 FROM mip_event_video_recaps LIMIT 1;

INSERT INTO mip_event_catalogs_rollback_guard (guard_id)
SELECT 1
FROM mip_event_types event_type
LEFT JOIN (
  SELECT app_id, event_type_key, COUNT(*) AS event_count
  FROM mip_events
  GROUP BY app_id, event_type_key
) event ON event.app_id = event_type.app_id AND event.event_type_key = event_type.type_key
WHERE event.event_count IS NULL
   OR event_type.name <> event_type.type_key
   OR event_type.description <> ''
   OR event_type.sort_order <> 0
   OR event_type.status <> 'ACTIVE'
   OR event_type.version <> 1
LIMIT 1;

DROP TEMPORARY TABLE mip_event_catalogs_rollback_guard;

ALTER TABLE mip_events
  DROP FOREIGN KEY mip_events_type_catalog_fk,
  DROP INDEX mip_events_type_catalog_idx;

DROP TABLE IF EXISTS mip_event_video_recaps;
DROP TABLE IF EXISTS mip_event_tag_assignments;
DROP TABLE IF EXISTS mip_event_tags;
DROP TABLE IF EXISTS mip_event_types;
