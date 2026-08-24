ALTER TABLE mip_cooperation_cards
  DROP INDEX mip_cooperation_cards_owner_role_uk,
  DROP CHECK mip_cooperation_cards_status_ck,
  DROP CHECK mip_cooperation_cards_publication_ck,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER published_at,
  ADD COLUMN active_role_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN status = 'ARCHIVED' THEN NULL ELSE role_key END
    ) STORED AFTER archived_at,
  ADD UNIQUE KEY mip_cooperation_cards_active_role_uk (app_id, owner_user_id, active_role_key),
  ADD KEY mip_cooperation_cards_archive_idx (app_id, status, archived_at DESC, id),
  ADD CONSTRAINT mip_cooperation_cards_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
  ),
  ADD CONSTRAINT mip_cooperation_cards_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
    OR status = 'ARCHIVED'
  ),
  ADD CONSTRAINT mip_cooperation_cards_archive_ck CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  );

ALTER TABLE mip_super_cases
  DROP CHECK mip_super_cases_status_ck,
  DROP CHECK mip_super_cases_publication_ck,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER published_at,
  ADD KEY mip_super_cases_archive_idx (app_id, status, archived_at DESC, id),
  ADD CONSTRAINT mip_super_cases_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
  ),
  ADD CONSTRAINT mip_super_cases_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
    OR status = 'ARCHIVED'
  ),
  ADD CONSTRAINT mip_super_cases_archive_ck CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL)
  );
