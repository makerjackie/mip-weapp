-- 回滚 103：移除视频号目标列与约束；jump_url 从未删除，无需恢复。
ALTER TABLE mip_videos
  DROP INDEX mip_videos_public_recap_idx,
  DROP CHECK mip_videos_destination_ck,
  DROP CHECK mip_videos_finder_ck,
  DROP COLUMN feed_id,
  DROP COLUMN finder_user_name;
