ALTER TABLE mip_events
  DROP CHECK mip_events_guide_url_ck,
  DROP COLUMN guide_url;
