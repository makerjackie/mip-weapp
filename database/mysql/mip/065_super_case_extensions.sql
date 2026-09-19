-- M04: Extend mip_super_cases with one-line summary, region tag, content
-- version, and modifier. Extend status CHECK to include TAKEN_DOWN.

ALTER TABLE mip_super_cases
  ADD COLUMN one_line_summary VARCHAR(255) NULL AFTER summary,
  ADD COLUMN region_tag_id BIGINT UNSIGNED NULL AFTER industry_tag_id,
  ADD COLUMN content_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER version,
  ADD COLUMN modified_by_user_id BIGINT UNSIGNED NULL AFTER owner_user_id,
  ADD KEY mip_super_cases_region_idx (app_id, region_tag_id, status, published_at DESC, id),
  ADD KEY mip_super_cases_content_version_idx (app_id, content_version, updated_at DESC, id),
  DROP CHECK mip_super_cases_status_ck,
  ADD CONSTRAINT mip_super_cases_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'TAKEN_DOWN')
  ),
  DROP CHECK mip_super_cases_publication_ck,
  ADD CONSTRAINT mip_super_cases_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
    OR status = 'ARCHIVED'
    OR status = 'TAKEN_DOWN'
  );
