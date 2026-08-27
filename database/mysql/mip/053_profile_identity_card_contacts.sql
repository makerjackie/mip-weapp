ALTER TABLE mip_profiles
  ADD COLUMN real_name VARCHAR(64) NULL AFTER nickname,
  ADD COLUMN gender VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER real_name,
  ADD COLUMN career_identity_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER identity_status,
  ADD CONSTRAINT mip_profiles_gender_ck CHECK (gender IS NULL OR gender IN ('UNKNOWN', 'MALE', 'FEMALE')),
  ADD CONSTRAINT mip_profiles_career_identity_key_ck CHECK (
    career_identity_key IS NULL OR career_identity_key REGEXP '^[a-z0-9_]{1,32}$'
  );

ALTER TABLE mip_private_profiles
  ADD COLUMN wechat_ciphertext VARBINARY(512) NULL AFTER phone_verified_at,
  ADD COLUMN email_ciphertext VARBINARY(512) NULL AFTER wechat_ciphertext,
  ADD COLUMN address_ciphertext VARBINARY(512) NULL AFTER email_ciphertext;
