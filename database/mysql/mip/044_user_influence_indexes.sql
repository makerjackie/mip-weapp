ALTER TABLE mip_event_invitation_attributions
  ADD KEY mip_invite_attr_guest_time_idx (
    app_id, guest_user_id, captured_at DESC, registration_id DESC
  ),
  ADD KEY mip_invite_attr_inviter_time_idx (
    app_id, inviter_user_id, captured_at DESC, registration_id DESC
  );

ALTER TABLE mip_event_hearts
  ADD KEY mip_event_hearts_voter_time_idx (
    app_id, voter_user_id, updated_at DESC, id DESC
  ),
  ADD KEY mip_event_hearts_target_time_idx (
    app_id, target_user_id, updated_at DESC, id DESC
  );

ALTER TABLE mip_profile_visits
  ADD KEY mip_profile_visits_visitor_time_idx (
    app_id, visitor_user_id, visited_at DESC, id DESC
  );
