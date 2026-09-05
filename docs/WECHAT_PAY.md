# 微信支付

MIP 使用 `mip-cloudpay`、`mip-cloudpay-callback`、`mip-refund-worker` 和 `mip-payment-ledger` 完成 CloudPay 支付与退款。客户端只提交订单意图，服务端从 `mip_orders`、会员/知识商品目录和活动名额重建金额、商品和资格。

## 统一订单

`mip_orders` 是会员、活动和单内容解锁的唯一订单事实：

- `order_type=MEMBERSHIP`：`membership_plan_id` 指向 `mip_membership_plans`，支付确认后由 ledger 重建 `mip_membership_entitlements`；有效权益决定用户是玩家，否则是嘉宾。
- `order_type=EVENT`：`resource_id` 指向活动，支付前创建短期 `mip_event_seat_holds` 和活动报名，支付确认后在同一 ledger 事务中消耗名额并完成报名。
- `order_type=CONTENT`：`resource_id` 指向知识内容，支付确认后由 ledger 按订单中的不可变商品快照创建 `mip_knowledge_entitlements`。
- 订单金额、货币、商户单号和商品快照由服务端写入；客户端不能传金额、价格、商户单号或权益天数。

会员方案的 `TEST` 与 `LIVE` 目录隔离。`MIP_PAYMENT_MODE=disabled` 时支付动作关闭；没有完整商户配置时，真实模式必须失败关闭，不得显示支付成功或发放权益。

从 `test` 或 `live` 切回 `disabled` 时，核心部署不会删除支付适配器、回调或退款 worker，避免截断已有订单的晚到回调和恢复路径；它会幂等禁止这三个函数的客户端调用，并拒绝任何残留 timer。重新启用支付必须重新运行支付部署和完整云端验收。

## 支付流程

1. `mip-commerce-api` 创建或读取当前用户的可支付 `mip_orders` 订单。
2. 客户端调用支付 adapter 时只提交 `orderId`，不提交金额和商户单号。
3. `mip-cloudpay` 通过 ledger 校验订单状态、用户身份、金额、商品目录和活动名额，再调用 CloudPay 生成支付参数。
4. 客户端 `wx.requestPayment` 成功只表示调起完成，页面进入待确认状态。
5. `mip-cloudpay-callback` 验签并把回调交给 ledger；客户端也可通过权威查单触发同一确认流程。
6. ledger 在 InnoDB 事务中校验商户单号、支付单号、金额和货币，幂等更新订单，并按订单类型发放会员/单内容权益或完成活动报名。

只有 `mip_orders.status=PAID` 才能作为支付完成事实。活动支付确认会在同一事务锁定并核对订单、名额保留和报名的 order/event/user 关系；只有 `ACTIVE` 名额保留与 `PAYMENT_PENDING` 报名的两个条件更新均成功后才发布报名确认，任一状态或并发版本不符即整笔回滚。退款、活动名额过期和权益重算也由 ledger 的状态迁移决定，客户端不能写订单、报名或权益状态。

付费活动占位过期后，订单页先请求报名服务按当前资格、容量及窗口续期原订单占位，再调用支付；旧订单页必须匹配报名当前关联订单，不能续期另一笔订单。已取消重报后，原订单迟到付款创建独立的 `PENDING` 退款；仅当原占位已取消或过期、原订单不再关联报名且退款幂等标识匹配时，允许退款 worker 提交和回调收敛。该退款不取消新报名，也不受新报名的签到状态影响。

## 退款

退款请求先在同一事务写入 `mip_refunds` 并把订单锁定为 `REFUND_PENDING`。用户退款可由 `mip-cloudpay` 提交；管理端单笔退款和活动取消产生的退款由 `mip-refund-worker` 提交。两个适配器都只向 ledger 提交退款 ID，商户订单号、退款单号、金额、货币和权益全部由 ledger 回查，不能采用客户端或管理页面传入的金额。

活动订单不能通过通用订单退款入口申请。用户必须从活动详情或“我的活动”执行取消；服务端在同一事务锁定活动、报名、有效签到、订单和名额事实，把报名迁移到 `CANCELLATION_PENDING` 后才创建剩余可退金额的退款。两个页面共用同一个客户端编排：事务提交后立即尝试 provider submit；调用失败不回滚取消事实，服务端投影 `canRetryRefund`，由两个页面显示“继续处理退款”并重放同一取消和 provider 幂等链。`PARTIALLY_REFUNDED` 只退未被成功或处理中退款占用的余额，`REFUND_PENDING` 和 `CANCELLATION_PENDING` 重放不创建重复退款；provider 明确失败后会创建新的退款尝试，历史商户退款单号保持不变。

后台强制活动退款也必须先锁定并核对订单关联的报名和签到。有效签到存在或报名关系不一致时失败关闭，运营需先撤销签到或人工核对，不能先退款后保留参加资格。退款成功回调再次锁定订单、报名和签到；只有报名仍为 `CANCELLATION_PENDING` 且无有效签到时才可完成订单退款和报名取消。关系、状态或并发版本异常会把 `mip_payment_callbacks.processing_status` 记为 `FAILED` 并保留错误码，不写退款成功或报名取消 outbox，待运营核对后重放。

`mip-refund-worker` 使用独立 HMAC，只接受管理 API 或受控运营命令调用。每次退款尝试使用不可变的服务端商户退款单号；进程中断、活动批量退款超过单次处理上限、晚到支付自动退款或 provider 仍处理中时，可重复运行恢复命令。worker 会扫描 `PENDING`、`PROVIDER_CREATED`、`PROCESSING`，提交或查单后再由 ledger 收敛状态；重复调用不得重复扣减权益。provider 返回 `CHANGE` 时不得释放退款占额：ledger 以 `PROCESSING + MANUAL_REVIEW_CHANGE` 保留不可自动重提的人工核对事实，批处理扫描会排除该记录，显式查单和权威 `SUCCESS` 回调仍可收敛；只有 `REFUNDCLOSE` 可以迁移为 `FAILED` 并释放占额。历史上误记为 `FAILED + CHANGE` 的记录只在不存在竞争中的退款且累计成功金额不超订单金额时接受迟到 `SUCCESS`，否则失败关闭并进入回调补偿核对。退款命令不复用通知或成长 outbox，worker 也不安装高频定时器。

支付回调只接受明确的 `tradeState=SUCCESS`，退款回调只接受明确的 `refundStatus=SUCCESS`。`returnCode/resultCode=SUCCESS` 仅表示通信或接口调用成功，不能作为支付或退款完成事实；`PROCESSING`、`CHANGE`、`REFUNDCLOSE` 以及缺少业务成功字段的回调全部失败关闭，不得写入 ledger 成功状态。

单内容商品的退款合同存入订单快照。`BEFORE_ACCESS` 只允许在快照规定的窗口内、尚未首次访问受保护正文且一次退还剩余全额时申请；`NON_REFUNDABLE` 始终拒绝。全额退款确认后 ledger 撤销单内容权益。后台和用户端复用同一服务端判断，不能读取当前商品配置覆盖历史订单规则。

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

部署三个可选支付函数前必须先部署核心函数清单和对应 `mip_*` schema。支付函数使用 Node.js 20.19、可信 AppID、专用回调函数名和独立退款 worker HMAC；商户号、证书、签名材料和内部密钥只进入函数配置，日志不得输出 OpenID、金额密钥或支付凭证。团队赛季与排行榜只按当前有效会员权益开放；它们读取 ledger 已确认的权益和服务端成长流水，不读取客户端支付结果或客户端分数。

源码门禁：

```bash
pnpm verify:source
pnpm verify:server
pnpm verify
```

正式商户下单、回调、查单、退款、权益生效仍必须在真机和生产支付环境验收。未完成这些证据时，只能说明源码合同通过，不能声称真实支付已通过。
