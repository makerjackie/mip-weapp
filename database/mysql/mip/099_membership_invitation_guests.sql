-- Membership inviter <-> invitee relationship, captured when the invitee joins
-- the mini-program as a GUEST via a membership invitation share. This is the
-- pre-purchase stage of the relationship (mip_membership_attributions keeps the
-- entitlement-stage record locked at payment time). One row per invitee: the
-- first valid invitation wins and later shares never rewrite it.
CREATE TABLE IF NOT EXISTS mip_membership_invitation_guests (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  guest_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inviter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USER',
  source_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, guest_user_id),
  KEY mip_membership_invitation_guests_inviter_idx (app_id, inviter_user_id, captured_at DESC),
  CONSTRAINT mip_membership_invitation_guests_guest_fk FOREIGN KEY (app_id, guest_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_invitation_guests_inviter_fk FOREIGN KEY (app_id, inviter_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_invitation_guests_source_ck CHECK (source_type = 'USER')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
