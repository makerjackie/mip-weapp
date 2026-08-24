-- Structural rollback only. It fails closed while an exact revocation leaves negative experience.
ALTER TABLE mip_growth_entries
  ADD CONSTRAINT mip_growth_entries_balance_ck CHECK (
    metric <> 'EXPERIENCE' OR balance_after >= 0
  );

ALTER TABLE mip_growth_accounts
  MODIFY experience_balance BIGINT UNSIGNED NOT NULL DEFAULT 0;

DROP TABLE IF EXISTS mip_event_checkin_transitions;
