-- Backfill stable human-readable ticket codes for valid registrations that
-- predate the activity-operations migration. The dynamic QR credential remains
-- short-lived and independently revocable.

UPDATE member_registrations
SET ticket_code = CONCAT(
  'TB',
  UPPER(SUBSTRING(SHA2(CONCAT(app_id, ':', id), 256), 1, 20))
)
WHERE status IN ('REGISTERED', 'ATTENDED')
  AND (ticket_code IS NULL OR ticket_code = '');
