UPDATE mip_notification_grants
SET status = 'EXPIRED',
  reservation_task_id = NULL,
  reservation_token = NULL,
  reservation_expires_at = NULL
WHERE status = 'RESERVED';

ALTER TABLE mip_notification_grants
  DROP CHECK mip_notification_grants_reservation_ck,
  DROP FOREIGN KEY mip_notification_grants_reservation_task_fk,
  DROP INDEX mip_notification_grants_task_reservation_uk,
  DROP CHECK mip_notification_grants_status_ck,
  DROP COLUMN reservation_expires_at,
  DROP COLUMN reservation_token,
  DROP COLUMN reservation_task_id,
  ADD CONSTRAINT mip_notification_grants_status_ck CHECK (
    status IN ('AVAILABLE', 'CONSUMED', 'EXPIRED', 'REVOKED')
  );
