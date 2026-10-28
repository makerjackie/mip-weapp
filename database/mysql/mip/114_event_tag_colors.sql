ALTER TABLE mip_event_tags
  ADD COLUMN background_color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '#7acbff',
  ADD COLUMN text_color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '#000000',
  ADD CONSTRAINT chk_event_tag_background CHECK (background_color IN ('#7acbff', '#fcdf03', '#18e779', '#ff4d5e')),
  ADD CONSTRAINT chk_event_tag_text CHECK (text_color IN ('#000000', '#ffffff'));
