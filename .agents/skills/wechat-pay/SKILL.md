---
name: wechat-pay
description: Use for membership checkout, CloudPay, ledger, callback, or refund changes in mip-weapp.
---

# WeChat Pay

## Trigger

支付、下单、查单、回调、退款、`MEMBERSHIP_PAYMENT_MODE`。

## Scope

`src/modules/membership`、`cloudfunctions/membership-cloudpay*`、`cloudfunctions/membership-payment-ledger`、`docs/WECHAT_PAY.md`。

## Read first

1. [docs/WECHAT_PAY.md](../../../docs/WECHAT_PAY.md)
2. [docs/SECURITY.md](../../../docs/SECURITY.md)
3. [docs/MEMBERSHIP_DOMAIN.md](../../../docs/MEMBERSHIP_DOMAIN.md)

## Steps

1. 客户端支付只提交 `action` 与 `orderId`，不要提交金额或商户单号。
2. 价格、时长、权益只来自服务端方案目录和 ledger 事务。
3. `wx.requestPayment` 成功后必须等到订单 `PAID`。
4. 回调验签、幂等，重复回调不得重复发货。
5. test 与 live 商品目录必须隔离。
6. 未配置支付时真实模式失败关闭，界面写「尚未配置」或「会员服务即将开放」，不要伪造成功。

## Scripts

`pnpm test` · `pnpm verify:source` · `pnpm verify:server` · `pnpm cloud:deploy-payment`

## Safety

商户号、证书、ledger HMAC 只放函数配置。日志不得输出 OpenID、金额密钥或 EnvID。

## Forbidden

客户端定价、用客户端成功当发货、回调不验签、退款由客户端写状态。

## Verify

`pnpm verify`。真机支付仍需人工验收。

## Done

源码契约与 ledger 测试通过；未配置时不会假装支付成功。

## Docs

[WECHAT_PAY.md](../../../docs/WECHAT_PAY.md) · [SECURITY.md](../../../docs/SECURITY.md)
