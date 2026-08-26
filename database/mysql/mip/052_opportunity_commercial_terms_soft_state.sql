ALTER TABLE mip_opportunity_commercial_terms
  ADD COLUMN status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'ACTIVE' AFTER max_amount_cents,
  ADD KEY mip_opportunity_commercial_terms_status_amount_idx (
    app_id, status, min_amount_cents, max_amount_cents, opportunity_id
  ),
  ADD CONSTRAINT mip_opportunity_commercial_terms_status_ck CHECK (
    status IN ('ACTIVE', 'INACTIVE')
  );
