ALTER TABLE mip_super_cases
  DROP CHECK mip_super_cases_status_ck,
  ADD CONSTRAINT mip_super_cases_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')
  ),
  DROP CHECK mip_super_cases_publication_ck,
  ADD CONSTRAINT mip_super_cases_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
    OR status = 'ARCHIVED'
  ),
  DROP KEY mip_super_cases_content_version_idx,
  DROP KEY mip_super_cases_region_idx,
  DROP COLUMN modified_by_user_id,
  DROP COLUMN content_version,
  DROP COLUMN region_tag_id,
  DROP COLUMN one_line_summary;
