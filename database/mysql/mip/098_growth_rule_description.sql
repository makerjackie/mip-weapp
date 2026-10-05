-- Admin-editable rule detail copy shown on the mini-program 规则详情 tab.
-- The rule identity (key/name/metric/source event) stays immutable; this column
-- only carries the display text, falling back to the derived daily-limit line
-- when unset.
ALTER TABLE mip_growth_rules
  ADD COLUMN description VARCHAR(500) NULL AFTER name;
