ALTER TABLE mip_growth_rules
  DROP CHECK mip_growth_rules_audit_mode_ck,
  DROP COLUMN rule_version,
  DROP COLUMN audit_mode;

ALTER TABLE mip_growth_entries
  DROP KEY mip_growth_entries_reversal_idx,
  DROP COLUMN reversal_of_entry_id;
