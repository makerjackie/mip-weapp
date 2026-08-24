-- MIP short check-in scene references for WeChat unlimited mini-program codes.
-- Additive only: existing UUID.secret credentials remain valid.

ALTER TABLE mip_event_checkin_credentials
  ADD COLUMN scan_key CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER event_id,
  ADD UNIQUE KEY mip_event_checkin_credentials_scan_key_uk (app_id, scan_key);
