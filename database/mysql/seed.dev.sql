INSERT INTO member_plans (
  app_id, id, name, description, price_cents, duration_days, benefits, environment, status
) VALUES
  ('__WECHAT_APP_ID__', 'annual-member', '同行会年度会员', '完整成员资料、会员活动与优先报名权益', 39900, 365, JSON_ARRAY('完整成员资料', '会员活动免费', '活动优先报名'), 'live', 'ACTIVE'),
  ('__WECHAT_APP_ID__', 'test-10-cents', '会员体验卡', '体验完整会员权益与活动服务', 10, 1, JSON_ARRAY('1 天会员权益'), 'test', 'ACTIVE')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  price_cents = VALUES(price_cents),
  duration_days = VALUES(duration_days),
  benefits = VALUES(benefits),
  environment = VALUES(environment),
  status = 'ACTIVE',
  updated_at = CURRENT_TIMESTAMP(3);
