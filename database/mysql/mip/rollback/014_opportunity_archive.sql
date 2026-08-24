-- Structural rollback only. It fails closed while any archived opportunity remains.
ALTER TABLE mip_opportunities
  DROP FOREIGN KEY mip_opportunities_archived_by_fk,
  DROP CHECK mip_opportunities_archive_ck,
  DROP CHECK mip_opportunities_publication_ck,
  DROP CHECK mip_opportunities_status_ck,
  DROP INDEX mip_opportunities_archive_idx,
  DROP COLUMN archive_reason,
  DROP COLUMN archived_by_user_id,
  DROP COLUMN archived_at,
  ADD CONSTRAINT mip_opportunities_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED')
  ),
  ADD CONSTRAINT mip_opportunities_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'ENDED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  );
