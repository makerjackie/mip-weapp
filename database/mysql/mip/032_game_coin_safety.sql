ALTER TABLE mip_growth_accounts
  ADD KEY mip_growth_accounts_coin_idx (app_id, coin_balance DESC, user_id),
  ADD CONSTRAINT mip_growth_accounts_coin_balance_ck CHECK (coin_balance >= 0);

ALTER TABLE mip_growth_entries
  ADD CONSTRAINT mip_growth_entries_coin_balance_ck CHECK (
    metric <> 'COIN' OR balance_after >= 0
  );
