-- Remove only codes produced deterministically by 006. Codes created by the
-- normal registration workflow are left untouched.

UPDATE member_registrations
SET ticket_code = NULL
WHERE status IN ('REGISTERED', 'ATTENDED')
  AND ticket_code = CONCAT(
    'TB',
    UPPER(SUBSTRING(SHA2(CONCAT(app_id, ':', id), 256), 1, 20))
  );
