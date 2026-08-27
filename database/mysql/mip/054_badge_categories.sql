ALTER TABLE mip_badges
  ADD COLUMN category VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'IDENTITY' AFTER description,
  ADD KEY mip_badges_category_idx (app_id, category, status, sort_order, id),
  ADD CONSTRAINT mip_badges_category_ck CHECK (category IN ('IDENTITY', 'HONOR'));
