ALTER TABLE mip_user_identities
  ADD COLUMN closed_identity_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER identity_key,
  ADD UNIQUE KEY mip_user_identities_closed_subject_uk (
    app_id, provider, closed_identity_key
  );

ALTER TABLE mip_users
  ADD COLUMN closed_at DATETIME(3) NULL AFTER status;

UPDATE mip_user_identities identity_record
INNER JOIN mip_users closed_user
  ON closed_user.app_id = identity_record.app_id
  AND closed_user.id = identity_record.user_id
SET identity_record.closed_identity_key = identity_record.identity_key,
  identity_record.identity_key = SHA2(
    CONCAT('closed:', identity_record.app_id, ':', identity_record.id, ':', identity_record.identity_key),
    256
  ),
  identity_record.union_identity_key = NULL
WHERE closed_user.status = 'CLOSED'
  AND identity_record.closed_identity_key IS NULL;

UPDATE mip_users
SET closed_at = COALESCE(updated_at, created_at)
WHERE status = 'CLOSED' AND closed_at IS NULL;

ALTER TABLE mip_users
  ADD CONSTRAINT mip_users_closure_ck CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL)
    OR (status IN ('ACTIVE', 'BLOCKED') AND closed_at IS NULL)
  );
