ALTER TABLE mip_referral_intents
  DROP FOREIGN KEY mip_referral_intents_target_fk,
  DROP INDEX mip_referral_intents_target_idx,
  DROP COLUMN target_user_id;
