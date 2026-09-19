-- M06: Add reversal support to mip_growth_entries and audit/rule-version
-- columns to mip_growth_rules.

ALTER TABLE mip_growth_entries
  ADD COLUMN reversal_of_entry_id BIGINT UNSIGNED NULL AFTER adjustment_reason,
  ADD KEY mip_growth_entries_reversal_idx (app_id, reversal_of_entry_id);

ALTER TABLE mip_growth_rules
  ADD COLUMN audit_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AUTO' AFTER status,
  ADD COLUMN rule_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER version,
  ADD CONSTRAINT mip_growth_rules_audit_mode_ck CHECK (
    audit_mode IN ('AUTO', 'MANUAL')
  );
