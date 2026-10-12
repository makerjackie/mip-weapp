-- 回退「允许超售」：直接删列即可；该列不参与任何存量数据语义（候补列保持不变）。
ALTER TABLE mip_events
  DROP CONSTRAINT mip_events_oversell_ck,
  DROP COLUMN oversell_enabled;
