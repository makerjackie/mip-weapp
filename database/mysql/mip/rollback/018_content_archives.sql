-- Structural rollback only. It fails closed while archived content or duplicate historical roles remain.
ALTER TABLE mip_super_cases
  DROP CHECK mip_super_cases_archive_ck,
  DROP CHECK mip_super_cases_publication_ck,
  DROP CHECK mip_super_cases_status_ck,
  DROP INDEX mip_super_cases_archive_idx,
  DROP COLUMN archived_at,
  ADD CONSTRAINT mip_super_cases_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
  ),
  ADD CONSTRAINT mip_super_cases_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  );

ALTER TABLE mip_cooperation_cards
  DROP CHECK mip_cooperation_cards_archive_ck,
  DROP CHECK mip_cooperation_cards_publication_ck,
  DROP CHECK mip_cooperation_cards_status_ck,
  DROP INDEX mip_cooperation_cards_archive_idx,
  DROP INDEX mip_cooperation_cards_active_role_uk,
  DROP COLUMN active_role_key,
  DROP COLUMN archived_at,
  ADD UNIQUE KEY mip_cooperation_cards_owner_role_uk (app_id, owner_user_id, role_key),
  ADD CONSTRAINT mip_cooperation_cards_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
  ),
  ADD CONSTRAINT mip_cooperation_cards_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  );
