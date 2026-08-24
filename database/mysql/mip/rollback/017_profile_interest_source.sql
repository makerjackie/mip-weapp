ALTER TABLE mip_users
  DROP INDEX mip_users_discovery_idx;

-- Rollback requires PROFILE-sourced interests to be absent.
ALTER TABLE mip_profile_interests
  DROP CHECK mip_profile_interests_source_ck,
  ADD CONSTRAINT mip_profile_interests_source_ck CHECK (
    source_type IN ('OPPORTUNITY', 'COOPERATION_CARD', 'SUPER_CASE')
  );
