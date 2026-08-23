# WeChat Pay

会员支付走 CloudPay + 独立 ledger，不是页面里直接 `wx.requestPayment` 完事。

## 规则

- 客户端创建支付只传 `orderId`
- 服务端按受信方案计算金额
- 必须先有本地订单
- 支付参数由 `mip-cloudpay` 生成
- `wx.requestPayment` success 只表示客户端调起完成
- 权益只认 ledger 的 `PAID` 事实
- 回调验签且幂等
- 退款有明确状态，客户端不能伪造
- 金额用整数分
- test/live 目录隔离
- 未配置真实商户时，真实模式失败关闭

部署：

```bash
pnpm cloud:deploy-payment -- --confirm-function=mip-cloudpay --confirm-callback=mip-cloudpay-callback
```

没有真实商户时，不得声称真实支付已通过。
