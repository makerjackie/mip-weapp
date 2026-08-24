ALTER TABLE mip_referral_intents
  ADD COLUMN target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER actor_user_id;

UPDATE mip_referral_intents referral
INNER JOIN mip_opportunities opportunity
  ON opportunity.app_id = referral.app_id
  AND opportunity.id = referral.opportunity_id
SET referral.target_user_id = opportunity.owner_user_id
WHERE referral.target_user_id IS NULL;

ALTER TABLE mip_referral_intents
  MODIFY COLUMN target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD KEY mip_referral_intents_target_idx (
    app_id, target_user_id, status, updated_at DESC, id
  ),
  ADD CONSTRAINT mip_referral_intents_target_fk
    FOREIGN KEY (app_id, target_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT;
