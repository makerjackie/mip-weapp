-- 回退价值模式列：删列即可；存量金额（min/max cents）与状态不受影响，
-- 服务端旧代码按「无 value_mode = RANGE」读取，展示回到 ¥ 口径。
ALTER TABLE mip_opportunity_commercial_terms
  DROP CONSTRAINT mip_opportunity_commercial_terms_value_mode_ck,
  DROP COLUMN value_mode;
