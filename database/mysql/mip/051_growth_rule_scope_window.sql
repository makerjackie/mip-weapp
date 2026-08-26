ALTER TABLE mip_growth_rules
  ADD COLUMN scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PLATFORM' AFTER source_event_type,
  ADD COLUMN scope_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER scope_type,
  ADD COLUMN effective_from DATETIME(3) NULL AFTER scope_id,
  ADD COLUMN effective_to DATETIME(3) NULL AFTER effective_from,
  ADD KEY mip_growth_rules_scope_idx (app_id, scope_type, scope_id, source_event_type, status, effective_from, id),
  ADD CONSTRAINT mip_growth_rules_scope_fk FOREIGN KEY (app_id, scope_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_growth_rules_scope_ck CHECK (
    (scope_type = 'PLATFORM' AND scope_id IS NULL)
    OR (scope_type = 'BRANCH' AND scope_id IS NOT NULL)
  ),
  ADD CONSTRAINT mip_growth_rules_effective_window_ck CHECK (
    effective_to IS NULL OR (effective_from IS NOT NULL AND effective_to > effective_from)
  );
