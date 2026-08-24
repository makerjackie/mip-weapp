ALTER TABLE mip_growth_entries
  DROP CHECK mip_growth_entries_coin_balance_ck;

ALTER TABLE mip_growth_accounts
  DROP CHECK mip_growth_accounts_coin_balance_ck,
  DROP INDEX mip_growth_accounts_coin_idx;
