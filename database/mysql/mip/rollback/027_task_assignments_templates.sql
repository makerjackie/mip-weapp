DROP TABLE IF EXISTS mip_task_assignments;

ALTER TABLE mip_task_cards
  DROP CHECK mip_task_cards_assignment_mode_ck,
  DROP FOREIGN KEY mip_task_cards_template_fk,
  DROP KEY mip_task_cards_assignment_idx,
  DROP COLUMN template_asset_id,
  DROP COLUMN ends_at,
  DROP COLUMN assignment_mode;
