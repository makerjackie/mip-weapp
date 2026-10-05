-- Badge definition fields from the admin 勋章管理 design (20260929-admin):
-- acquire_condition documents how a badge is earned. It is display-only copy —
-- grants stay manual in mip_user_badges and nothing grants automatically.
-- image_asset_id points at an uploaded mip_media_assets row (purpose BADGE_IMAGE)
-- so admins can upload the badge artwork; image_url keeps accepting a manual
-- HTTPS address as a fallback. Readers prefer the asset's cloud file id.
ALTER TABLE mip_badges
  ADD COLUMN acquire_condition VARCHAR(300) NOT NULL DEFAULT '' AFTER description,
  ADD COLUMN image_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER image_url,
  ADD KEY mip_badges_asset_idx (app_id, image_asset_id),
  ADD CONSTRAINT mip_badges_asset_fk FOREIGN KEY (app_id, image_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT;
