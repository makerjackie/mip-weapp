-- 机会价值金额双模式（MIW-89，产品 2026-10-13 对齐会）：
--   RANGE        既有万元区间（列默认值，存量行零迁移即保持现状展示）；
--   SINGLE       小程序千单位单值（min_amount_cents = max_amount_cents = 千 × 100,000）；
--   NEGOTIATION  面谈（金额必空，行保持 ACTIVE，服务端生成「面谈」展示）。
-- 金额仍统一以分为唯一基准，value_mode 只区分语义与展示，不引入第二套金额存储。
ALTER TABLE mip_opportunity_commercial_terms
  ADD COLUMN value_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'RANGE',
  ADD CONSTRAINT mip_opportunity_commercial_terms_value_mode_ck CHECK (
    value_mode IN ('RANGE', 'SINGLE', 'NEGOTIATION')
  );
