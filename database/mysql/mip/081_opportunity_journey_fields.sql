ALTER TABLE mip_opportunities
  DROP CHECK mip_opportunities_publication_ck,
  ADD CONSTRAINT mip_opportunities_publication_ck CHECK (
    status = 'ARCHIVED'
    OR (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'ENDED', 'UNPUBLISHED') AND published_at IS NOT NULL)
  ),
  ADD COLUMN region_text VARCHAR(60) NULL AFTER city_tag_id,
  ADD COLUMN players_only BOOLEAN NOT NULL DEFAULT FALSE AFTER region_text,
  ADD COLUMN type_keys_json JSON NULL AFTER region_text,
  ADD CONSTRAINT mip_opportunities_type_keys_ck CHECK (
    type_keys_json IS NULL OR (
      JSON_TYPE(type_keys_json) = 'ARRAY' AND JSON_LENGTH(type_keys_json) <= 3
    )
  );
