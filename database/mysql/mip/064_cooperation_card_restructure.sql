-- M04: Restructure mip_cooperation_cards with card_type, menu fields, and
-- quality-improvement columns. Migrate existing role_key values to card_type.

ALTER TABLE mip_cooperation_cards
  ADD COLUMN card_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER role_key,
  ADD COLUMN menu_fields_json JSON NULL AFTER ability_scores_json,
  ADD COLUMN quirks TEXT NULL AFTER menu_fields_json,
  ADD COLUMN root_cause TEXT NULL AFTER quirks,
  ADD COLUMN prevention TEXT NULL AFTER root_cause,
  ADD COLUMN cooperation_value TEXT NULL AFTER prevention,
  ADD KEY mip_cooperation_cards_card_type_idx (app_id, status, card_type, published_at DESC, id),
  ADD CONSTRAINT mip_cooperation_cards_card_type_ck CHECK (
    card_type IS NULL
    OR card_type IN ('PIMP', 'BUSINESS', 'RICH', 'PLANNER', 'DESIGNER', 'NANNY')
  );

UPDATE mip_cooperation_cards
SET card_type = CASE role_key
  WHEN 'connector' THEN 'PIMP'
  WHEN 'business_builder' THEN 'BUSINESS'
  WHEN 'capital_operator' THEN 'RICH'
  WHEN 'strategist' THEN 'PLANNER'
  WHEN 'visual_designer' THEN 'DESIGNER'
  WHEN 'delivery_lead' THEN 'NANNY'
  ELSE NULL
END
WHERE card_type IS NULL;
