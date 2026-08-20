-- Older event-create and event-duplicate workflows did not always assign the
-- actor as this new event's owner. Record the exact repair set first so the
-- data migration remains auditable and has a bounded rollback.

INSERT INTO member_audit_logs (
  app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
)
SELECT
  event.app_id,
  creator.actor_id,
  'migration',
  'EVENT_OWNER_BACKFILL_PLANNED',
  'event',
  event.id,
  JSON_OBJECT('migration', '013_event_owner_backfill')
FROM member_events event
INNER JOIN (
  SELECT app_id, resource_id, actor_id
  FROM (
    SELECT
      app_id,
      resource_id,
      actor_id,
      ROW_NUMBER() OVER (
        PARTITION BY app_id, resource_id
        ORDER BY created_at ASC, id ASC
      ) AS row_number
    FROM member_audit_logs
    WHERE resource_type = 'event'
      AND action IN ('EVENT_CREATED', 'EVENT_DUPLICATED')
  ) ranked_creator
  WHERE row_number = 1
) creator
  ON creator.app_id = event.app_id
 AND creator.resource_id = event.id
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
      AND repair.action = 'EVENT_OWNER_BACKFILL_PLANNED'
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
  AND repair.action = 'EVENT_OWNER_BACKFILL_PLANNED'
  AND JSON_UNQUOTE(JSON_EXTRACT(repair.metadata, '$.migration')) = '013_event_owner_backfill'
ON DUPLICATE KEY UPDATE
  role = 'EVENT_OWNER',
  status = 'ACTIVE',
  assigned_by = VALUES(assigned_by),
  updated_at = UTC_TIMESTAMP(3);
