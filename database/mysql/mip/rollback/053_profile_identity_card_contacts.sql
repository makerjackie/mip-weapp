ALTER TABLE mip_private_profiles
  DROP COLUMN address_ciphertext,
  DROP COLUMN email_ciphertext,
  DROP COLUMN wechat_ciphertext;

ALTER TABLE mip_profiles
  DROP CONSTRAINT mip_profiles_career_identity_key_ck,
  DROP CONSTRAINT mip_profiles_gender_ck,
  DROP COLUMN career_identity_key,
  DROP COLUMN gender,
  DROP COLUMN real_name;
