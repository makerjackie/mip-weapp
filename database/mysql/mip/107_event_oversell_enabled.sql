-- 活动报名满员策略新增「允许超售」：名额报满后仍继续接受报名（与候补互斥，产品拍板 2026-10-12）。
-- 付费活动不允许超售（沿用候补同款约束：收款不得超过容量），由 pricing/校验层共同拦截。
ALTER TABLE mip_events
  ADD COLUMN oversell_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER waitlist_enabled,
  ADD CONSTRAINT mip_events_oversell_ck CHECK (
    oversell_enabled IN (0, 1) AND (oversell_enabled = 0 OR waitlist_enabled = 0)
  );
