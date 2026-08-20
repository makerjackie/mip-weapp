-- 013 used a window-function alias rejected by the managed MySQL parser and
-- therefore left its repair set empty. Use a correlated minimum audit id,
-- which is supported by the current CloudBase MySQL runtime.

INSERT INTO member_audit_logs (
  app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
)
SELECT
  event.app_id,
  creator.actor_id,
  'migration',
  'EVENT_OWNER_BACKFILL_V2_PLANNED',
  'event',
  event.id,
  JSON_OBJECT('migration', '014_event_owner_backfill_v2')
FROM member_events event
INNER JOIN member_audit_logs creator
  ON creator.id = (
    SELECT MIN(candidate.id)
    FROM member_audit_logs candidate
    WHERE candidate.app_id = event.app_id
      AND candidate.resource_type = 'event'
      AND candidate.resource_id = event.id
      AND candidate.action IN ('EVENT_CREATED', 'EVENT_DUPLICATED')
  )
LEFT JOIN member_event_managers owner
  ON owner.app_id = event.app_id
 AND owner.event_id = event.id
 AND owner.role = 'EVENT_OWNER'
 AND owner.status = 'ACTIVE'
WHERE owner.user_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM member_audit_logs repair
    WHERE repair.app_id = event.app_id
      AND repair.resource_type = 'event'
      AND repair.resource_id = event.id
      AND repair.action = 'EVENT_OWNER_BACKFILL_V2_PLANNED'
  );

INSERT INTO member_event_managers (
  app_id, event_id, user_id, role, status, assigned_by
)
SELECT
  repair.app_id,
  repair.resource_id,
  repair.actor_id,
  'EVENT_OWNER',
  'ACTIVE',
  repair.actor_id
FROM member_audit_logs repair
WHERE repair.resource_type = 'event'
  AND repair.action = 'EVENT_OWNER_BACKFILL_V2_PLANNED'
  AND JSON_UNQUOTE(JSON_EXTRACT(repair.metadata, '$.migration')) = '014_event_owner_backfill_v2'
ON DUPLICATE KEY UPDATE
  role = 'EVENT_OWNER',
  status = 'ACTIVE',
  assigned_by = VALUES(assigned_by),
  updated_at = UTC_TIMESTAMP(3);
