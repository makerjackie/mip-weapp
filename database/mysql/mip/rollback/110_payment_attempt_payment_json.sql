-- 回退支付参数复用列：该列只保存可再生的历史签发参数，删除不影响订单、支付与退款事实
-- （回退后订单重试回到「重复下单必失败」的旧行为）。
ALTER TABLE mip_payment_attempts
  DROP COLUMN payment_json;
