-- Only roll back after exporting and retiring verification and rate-limit facts.
DROP TABLE IF EXISTS mip_phone_sms_challenges;
DROP TABLE IF EXISTS mip_phone_sms_rate_limits;
