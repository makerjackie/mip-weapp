ALTER TABLE mip_badges
  DROP FOREIGN KEY mip_badges_asset_fk,
  DROP KEY mip_badges_asset_idx,
  DROP COLUMN image_asset_id,
  DROP COLUMN acquire_condition;
