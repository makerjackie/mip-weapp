-- role_key data is preserved in the original column; only the new columns
-- and their indexes/constraints are removed.
ALTER TABLE mip_cooperation_cards
  DROP CHECK mip_cooperation_cards_card_type_ck,
  DROP KEY mip_cooperation_cards_card_type_idx,
  DROP COLUMN cooperation_value,
  DROP COLUMN prevention,
  DROP COLUMN root_cause,
  DROP COLUMN quirks,
  DROP COLUMN menu_fields_json,
  DROP COLUMN card_type;
