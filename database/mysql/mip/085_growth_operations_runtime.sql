-- Tenant scope for the previously unscoped contribution configuration.
-- Legacy rows cannot be attributed safely and stay quarantined with app_id NULL.
ALTER TABLE mip_contribution_rules
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN rule_uid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN reward_limit_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PER_EVENT',
  MODIFY COLUMN effective_from DATETIME(3) NOT NULL,
  MODIFY COLUMN effective_to DATETIME(3) NULL,
  ADD UNIQUE KEY mip_contribution_rules_uid_uk (app_id, rule_uid),
  ADD KEY mip_contribution_rules_tenant_behavior_idx (app_id, behavior, status, effective_from);

-- Reversals reference immutable growth entries; no second balance or transaction ledger.
ALTER TABLE mip_contribution_reversals
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN reversed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN growth_entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD KEY mip_contribution_reversals_tenant_original_idx (app_id, original_txn_no, reversed_at);
