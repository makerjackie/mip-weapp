-- Optional route-guide link (a web page or WeChat official-account article with
-- venue directions). The member detail page shows the 指引 button only when this
-- is set and opens it in a web-view; admins edit it on the event form.
ALTER TABLE mip_events
  ADD COLUMN guide_url VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER online_url,
  ADD CONSTRAINT mip_events_guide_url_ck CHECK (guide_url IS NULL OR guide_url LIKE 'https://%');
