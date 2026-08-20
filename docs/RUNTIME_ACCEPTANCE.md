# Runtime acceptance

静态门禁通过后：

```bash
pnpm build
pnpm runtime:preflight
pnpm test:runtime
```

检查首页、认识、活动、我的、会员、订单、运营工作台。未配置云环境时不得连接原生产环境。未配置支付时不得假装支付成功。

必须真机：手机号、微信支付、订阅消息、扫码签到。开发者工具结果不能代替这些能力。
