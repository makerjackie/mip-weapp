ALTER TABLE mip_profiles
  DROP CHECK mip_profiles_career_identity_key_ck,
  ADD CONSTRAINT mip_profiles_career_identity_key_ck CHECK (
    career_identity_key IS NULL OR career_identity_key REGEXP '^[a-z0-9_]{1,32}$'
  );
