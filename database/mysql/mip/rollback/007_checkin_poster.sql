ALTER TABLE mip_event_checkin_credentials
  DROP INDEX mip_event_checkin_credentials_scan_key_uk,
  DROP COLUMN scan_key;
