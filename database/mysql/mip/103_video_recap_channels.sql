-- MIW-57 往期活动回顾改为后台独立配置的条目：mip_videos 增加视频号目标。
-- 原 jump_url 外链列按追加迁移政策保留为 dormant（可空、无默认值），代码全链路不再读写。
-- finder_user_name 必填（sph 开头）；feed_id 选填，配置后跳具体视频号动态
-- （wx.openChannelsActivity），仅配视频号时跳视频号主页（wx.openChannelsUserProfile）。
-- 公共往期列表按 (app_id, status, sort_order, video_id DESC) 读取，补对应索引。
ALTER TABLE mip_videos
  ADD COLUMN finder_user_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER title,
  ADD COLUMN feed_id VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER finder_user_name,
  ADD CONSTRAINT mip_videos_finder_ck CHECK (
    finder_user_name IS NULL OR finder_user_name REGEXP '^sph[A-Za-z0-9]+$'
  ),
  ADD CONSTRAINT mip_videos_destination_ck CHECK (
    feed_id IS NULL OR feed_id REGEXP '^[A-Za-z0-9_=+/.-]+$'
  ),
  ADD KEY mip_videos_public_recap_idx (app_id, status, sort_order, video_id DESC);
