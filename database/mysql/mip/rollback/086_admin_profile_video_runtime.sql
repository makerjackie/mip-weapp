DROP TABLE IF EXISTS mip_event_heart_history;
ALTER TABLE mip_cooperation_cards DROP COLUMN card_real_name, DROP COLUMN card_game_name, DROP COLUMN referral_needed;
ALTER TABLE mip_videos DROP CHECK mip_videos_version_ck, DROP INDEX mip_videos_app_list_idx,
  DROP COLUMN content_safety_status, DROP COLUMN version, DROP COLUMN app_id;
