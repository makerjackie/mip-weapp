ALTER TABLE mip_profiles
  DROP CHECK mip_profiles_career_identity_key_ck,
  ADD CONSTRAINT mip_profiles_career_identity_key_ck CHECK (
    career_identity_key IS NULL OR career_identity_key REGEXP '^[A-Z][A-Z0-9_]{0,31}$'
  );
