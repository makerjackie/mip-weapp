ALTER TABLE mip_growth_rules
  DROP FOREIGN KEY mip_growth_rules_scope_fk,
  DROP CHECK mip_growth_rules_scope_ck,
  DROP CHECK mip_growth_rules_effective_window_ck,
  DROP KEY mip_growth_rules_scope_idx,
  DROP COLUMN effective_to,
  DROP COLUMN effective_from,
  DROP COLUMN scope_id,
  DROP COLUMN scope_type;
