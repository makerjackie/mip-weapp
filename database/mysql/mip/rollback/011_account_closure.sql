-- Structural rollback only. Account data anonymized after closure cannot be restored.
ALTER TABLE mip_users
  DROP CHECK mip_users_closure_ck,
  DROP COLUMN closed_at;

ALTER TABLE mip_user_identities
  DROP INDEX mip_user_identities_closed_subject_uk,
  DROP COLUMN closed_identity_key;
