-- MIW-123：取消支付后的订单重试必须复用首次预支付参数。微信统一下单对同一商户订单号
-- 只允许成功提交一次（OUT_TRADE_NO_USED），重试再次下单必然失败并被误报为「支付未配置」。
-- 本列保存首次 unifiedOrder 成功返回的完整 wx.requestPayment 调起参数，外层附带签发商户号：
-- 商户/支付模式切换后拒绝复用旧参数（prepay_id 自签发起 2 小时内可重复拉起收银台）。
ALTER TABLE mip_payment_attempts
  ADD COLUMN payment_json JSON NULL AFTER prepay_id;
