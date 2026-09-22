-- M04: Add career and location fields to mip_profiles.

ALTER TABLE mip_profiles
  ADD COLUMN city_name VARCHAR(128) NULL AFTER career_identity_key,
  ADD COLUMN industry VARCHAR(128) NULL AFTER city_name,
  ADD COLUMN career_role VARCHAR(128) NULL AFTER industry,
  ADD COLUMN company VARCHAR(255) NULL AFTER career_role,
  ADD COLUMN position VARCHAR(128) NULL AFTER company,
  ADD COLUMN one_line_introduction VARCHAR(500) NULL AFTER introduction;
