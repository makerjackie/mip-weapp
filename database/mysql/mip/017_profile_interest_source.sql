ALTER TABLE mip_profile_interests
  DROP CHECK mip_profile_interests_source_ck,
  ADD CONSTRAINT mip_profile_interests_source_ck CHECK (
    source_type IN ('OPPORTUNITY', 'COOPERATION_CARD', 'SUPER_CASE', 'PROFILE')
  );

ALTER TABLE mip_users
  ADD KEY mip_users_discovery_idx (app_id, status, created_at DESC, id);
