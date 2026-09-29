-- Add management metadata without changing membership or granting administrative roles.
ALTER TABLE mip_city_branches
  ADD COLUMN leader_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  ADD UNIQUE KEY mip_city_branches_name_uk (app_id, name),
  ADD KEY mip_city_branches_sort_idx (app_id, sort_order, name, id),
  ADD CONSTRAINT mip_city_branches_leader_fk FOREIGN KEY (app_id, leader_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT;
