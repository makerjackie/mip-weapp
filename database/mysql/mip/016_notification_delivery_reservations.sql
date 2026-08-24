ALTER TABLE mip_notification_grants
  DROP CHECK mip_notification_grants_status_ck,
  ADD COLUMN reservation_task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER status,
  ADD COLUMN reservation_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER reservation_task_id,
  ADD COLUMN reservation_expires_at DATETIME(3) NULL
    AFTER reservation_token,
  ADD UNIQUE KEY mip_notification_grants_task_reservation_uk (app_id, reservation_task_id),
  ADD CONSTRAINT mip_notification_grants_reservation_task_fk
    FOREIGN KEY (app_id, reservation_task_id)
    REFERENCES mip_delivery_tasks (app_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_notification_grants_status_ck CHECK (
    status IN ('AVAILABLE', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REVOKED')
  ),
  ADD CONSTRAINT mip_notification_grants_reservation_ck CHECK (
    (
      status = 'RESERVED'
      AND reservation_task_id IS NOT NULL
      AND reservation_token IS NOT NULL
      AND reservation_expires_at IS NOT NULL
    )
    OR (
      status <> 'RESERVED'
      AND reservation_task_id IS NULL
      AND reservation_token IS NULL
      AND reservation_expires_at IS NULL
    )
  );
