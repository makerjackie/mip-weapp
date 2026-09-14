---
name: wechat-pay
description: Use for membership checkout, CloudPay, ledger, callback, or refund changes in mip-weapp.
---

# WeChat Pay

## Trigger

支付、下单、查单、回调、退款、`MIP_PAYMENT_MODE`。

## Scope

`src/modules/mip-commerce`、`cloudfunctions/mip-cloudpay`、`cloudfunctions/mip-cloudpay-callback`、`cloudfunctions/mip-payment-ledger`、`cloudfunctions/mip-refund-worker`、`docs/WECHAT_PAY.md`。

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
7. 原生 CloudPay V2 支付通知与查单响应不是同一协议：平台通知的 `returnCode/resultCode=SUCCESS` 可表示付款成功，不能强制要求查单的 `tradeState`；必须保留客户端禁止调用、身份/金额校验与 ledger 幂等。
8. `unifiedOrder` 使用驼峰参数；`queryOrder`、`refund`、`queryRefund` 使用官方下划线参数。退款查单还会返回 `refund_status_0` 等编号字段，测试应覆盖真实字段形状。
9. 管理端 SCF 直接调用可能缺少微信云调用令牌并报 `invalid wx openapi access_token`；应通过真实小程序登录态验证，不据此要求重做商户授权。

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
