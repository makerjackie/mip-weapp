-- Restoring the old constraint is intentionally blocked if published archives exist.
ALTER TABLE mip_opportunities
  DROP CHECK mip_opportunities_publication_ck,
  ADD CONSTRAINT mip_opportunities_publication_ck CHECK (
    (status IN ('DRAFT', 'ARCHIVED') AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'ENDED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  ),
  DROP CHECK mip_opportunities_type_keys_ck,
  DROP COLUMN type_keys_json,
  DROP COLUMN players_only,
  DROP COLUMN region_text;
