ALTER TABLE mip_opportunities
  DROP CHECK mip_opportunities_status_ck,
  DROP CHECK mip_opportunities_publication_ck,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER moderation_reason,
  ADD COLUMN archived_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER archived_at,
  ADD COLUMN archive_reason VARCHAR(240) NULL AFTER archived_by_user_id,
  ADD KEY mip_opportunities_archive_idx (app_id, status, archived_at DESC, id),
  ADD CONSTRAINT mip_opportunities_archived_by_fk FOREIGN KEY (app_id, archived_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_opportunities_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED')
  ),
  ADD CONSTRAINT mip_opportunities_publication_ck CHECK (
    (status IN ('DRAFT', 'ARCHIVED') AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'ENDED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  ),
  ADD CONSTRAINT mip_opportunities_archive_ck CHECK (
    (status = 'ARCHIVED'
      AND archived_at IS NOT NULL
      AND archived_by_user_id IS NOT NULL
      AND archive_reason IS NOT NULL
      AND CHAR_LENGTH(TRIM(archive_reason)) > 0)
    OR (status <> 'ARCHIVED'
      AND archived_at IS NULL
      AND archived_by_user_id IS NULL
      AND archive_reason IS NULL)
  );
