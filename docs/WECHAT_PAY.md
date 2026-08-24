# 微信支付

MIP 使用 `mip-cloudpay`、`mip-cloudpay-callback`、`mip-refund-worker` 和 `mip-payment-ledger` 完成 CloudPay 支付与退款。客户端只提交订单意图，服务端从 `mip_orders`、方案目录和活动名额重建金额、商品和资格。

## 统一订单

`mip_orders` 是会员和活动的唯一订单事实：

- `order_type=MEMBERSHIP`：`membership_plan_id` 指向 `mip_membership_plans`，支付确认后由 ledger 重建 `mip_membership_entitlements`；有效权益决定用户是玩家，否则是嘉宾。
- `order_type=EVENT`：`resource_id` 指向活动，支付前创建短期 `mip_event_seat_holds` 和活动报名，支付确认后在同一 ledger 事务中消耗名额并完成报名。
- 订单金额、货币、商户单号和商品快照由服务端写入；客户端不能传金额、价格、商户单号或权益天数。

会员方案的 `TEST` 与 `LIVE` 目录隔离。`MIP_PAYMENT_MODE=disabled` 时支付动作关闭；没有完整商户配置时，真实模式必须失败关闭，不得显示支付成功或发放权益。

## 支付流程

1. `mip-commerce-api` 创建或读取当前用户的可支付 `mip_orders` 订单。
2. 客户端调用支付 adapter 时只提交 `orderId`，不提交金额和商户单号。
3. `mip-cloudpay` 通过 ledger 校验订单状态、用户身份、金额、商品目录和活动名额，再调用 CloudPay 生成支付参数。
4. 客户端 `wx.requestPayment` 成功只表示调起完成，页面进入待确认状态。
5. `mip-cloudpay-callback` 验签并把回调交给 ledger；客户端也可通过权威查单触发同一确认流程。
6. ledger 在 InnoDB 事务中校验商户单号、支付单号、金额和货币，幂等更新订单，并按订单类型发放会员权益或完成活动报名。

只有 `mip_orders.status=PAID` 才能作为支付完成事实。退款、活动名额过期和权益重算也由 ledger 的状态迁移决定，客户端不能写订单、报名或权益状态。

## 退款

退款请求先在同一事务写入 `mip_refunds` 并把订单锁定为 `REFUND_PENDING`。用户退款可由 `mip-cloudpay` 提交；管理端单笔退款和活动取消产生的退款由 `mip-refund-worker` 提交。两个适配器都只向 ledger 提交退款 ID，商户订单号、退款单号、金额、货币和权益全部由 ledger 回查，不能采用客户端或管理页面传入的金额。

`mip-refund-worker` 使用独立 HMAC，只接受管理 API 或受控运营命令调用。首次调用以不可变 `merchant_refund_no` 提交；进程中断、活动批量退款超过单次处理上限、晚到支付自动退款或 provider 仍处理中时，可重复运行恢复命令。worker 会扫描 `PENDING`、`PROVIDER_CREATED`、`PROCESSING`，提交或查单后再由 ledger 收敛状态；重复调用不得重复扣减权益。退款命令不复用通知或成长 outbox，worker 也不安装高频定时器。

## 部署和验收

```bash
pnpm cloud:deploy-payment -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-cloudpay \
  --confirm-callback=mip-cloudpay-callback \
  --confirm-refund=mip-refund-worker

pnpm refunds:run -- \
  --confirm-env=<EnvID> \
  --confirm-refund=mip-refund-worker \
  --limit=10
```

部署三个可选支付函数前必须先部署 13 个核心函数和对应 `mip_*` schema。支付函数使用 Node.js 20.19、可信 AppID、专用回调函数名和独立退款 worker HMAC；商户号、证书、签名材料和内部密钥只进入函数配置，日志不得输出 OpenID、金额密钥或支付凭证。

源码门禁：

```bash
pnpm verify:source
pnpm verify:server
pnpm verify
```

正式商户下单、回调、查单、退款、权益生效仍必须在真机和生产支付环境验收。未完成这些证据时，只能说明源码合同通过，不能声称真实支付已通过。
