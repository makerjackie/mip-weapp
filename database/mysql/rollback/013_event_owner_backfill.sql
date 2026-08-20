-- Remove only owner assignments named by this migration's repair audit.

DELETE manager
FROM member_event_managers manager
INNER JOIN member_audit_logs repair
  ON repair.app_id = manager.app_id
 AND repair.resource_type = 'event'
 AND repair.resource_id = manager.event_id
 AND repair.action = 'EVENT_OWNER_BACKFILL_PLANNED'
 AND repair.actor_id = manager.user_id
WHERE manager.role = 'EVENT_OWNER'
  AND manager.status = 'ACTIVE'
  AND manager.assigned_by = repair.actor_id
  AND JSON_UNQUOTE(JSON_EXTRACT(repair.metadata, '$.migration')) = '013_event_owner_backfill';

DELETE FROM member_audit_logs
WHERE resource_type = 'event'
  AND action = 'EVENT_OWNER_BACKFILL_PLANNED'
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.migration')) = '013_event_owner_backfill';
