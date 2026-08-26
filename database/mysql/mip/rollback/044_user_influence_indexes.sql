ALTER TABLE mip_profile_visits
  DROP KEY mip_profile_visits_visitor_time_idx;

ALTER TABLE mip_event_hearts
  DROP KEY mip_event_hearts_target_time_idx,
  DROP KEY mip_event_hearts_voter_time_idx;

ALTER TABLE mip_event_invitation_attributions
  DROP KEY mip_invite_attr_inviter_time_idx,
  DROP KEY mip_invite_attr_guest_time_idx;
