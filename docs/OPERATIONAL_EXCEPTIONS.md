# 异常中心

异常中心的通用异常列表是 `mip-admin-api` 提供的只读运营视图。它聚合当前 AppID 下已经持久化的异常状态，不提供重试、退款、删除素材或修改任务状态的接口。消息投递在同一页面提供独立的复核工作流；该工作流只按受控状态机认领、核对和结束复核，不把页面操作升级为投递成功事实。其他处置仍通过订单、活动、媒体清理和受控 worker 流程完成。

## 权限

- `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS` 通过平台范围 `operations.exceptions.read` 查看全部类型。
- `PLATFORM_FINANCE` 使用同一 capability，但服务端只返回支付和退款类型。
- 分会和活动角色不获得该 capability。
- 每次查看都会写入 `mip_audit_logs`，只记录筛选条件和返回数量。
- 投递复核另行要求平台范围 `messages.delivery.review`；只授予 `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS`，财务、分会和活动角色不能读取或操作复核记录。

## 数据范围

| 类型 | 纳入条件 |
| --- | --- |
| 业务事件 | `mip_outbox_events` 失败、达到最大尝试次数或租约已过期 |
| 退款 | `mip_refunds` 失败，或活动状态超过 30 分钟未更新 |
| 支付 | `mip_payment_attempts` 失败，或活动状态超过 30 分钟未更新 |
| 图片 | `mip_media_assets` 审核未通过，或处理状态超过 30 分钟未更新 |
| 通知 | `mip_delivery_tasks` 失败或处理租约已过期；最终无法证明外部结论的任务以不可重试的 `FAILED` 保留 |
| AI 草稿 | 处理失败、超过有效期仍在处理，或已结束草稿的私有音频仍待清理 |

`mip_media_assets` 当前只持久化 `PENDING`、`READY`、`REJECTED` 和 `DELETED`，没有 `ERROR` 状态；上传前发生的内容安全检查错误也不会创建素材记录。媒体孤儿清理领取素材时先将其收敛到非公开的 `PENDING` 删除态；存储删除失败、响应不明确或最终状态写入失败都保留 `PENDING`，由后续清理重试，不能恢复为 `READY`。数据库没有持久化单次清理失败原因。异常中心不会把没有持久化证据的上传或清理失败误报为异常；清理命令的失败数量仍以该次命令结果为准。

AI 终态语音的 `PENDING` 也表示已经领取的删除意图，不表示外部删除失败已被确认。运行 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 可在租约过期后重试；命令只返回批次状态和数量，异常中心不展示用户、草稿或文件标识。

## 消息投递复核

管理端使用 Web 中立的 v1 action：

- `mip.admin.messageDeliveryReviews.list`
- `mip.admin.messageDeliveryReviews.get`
- `mip.admin.messageDeliveryReviews.claim`
- `mip.admin.messageDeliveryReviews.reconcile`
- `mip.admin.messageDeliveryReviews.resolve`

列表默认只显示 `ACTIVE`，并提供显式 `RESOLVED` 已闭环筛选；服务端以 `occurredAt + id` 稳定游标分页，小程序通过“加载更多”继续读取，不把前 50 条当成全部数据。`RESOLVED` 和 `ALL` 由复核工作流驱动并实时读取当前业务事实，因此活动已完成或任务已投递后，已闭环记录仍可查。已闭环来源只有在新证据再次表明处理超时、结果未知或终止失败时才重新进入 `ACTIVE`；后续成功或进入安全自动重试不会重新打开人工流程。同一来源行只反映最新复核状态，认领、核对和闭环的变更由审计流水留痕，列表不承诺保留先前填写的说明或证据引用。

写操作必须先认领，认领租约为 15 分钟。`claim`、`reconcile` 和 `resolve` 都校验证据哈希、工作流版本和幂等键，并追加脱敏审计。`UNKNOWN` 不提供重试或重放操作，只能使用 `UNKNOWN_NO_REPLAY`、处理说明和可选非敏感证据引用结束复核；`TERMINAL_ACCEPTED` 只表示运营接受当前已确认终态，不表示 provider 投递成功。

## 返回合同

通用异常列表只返回来源、统一状态、固定标题和摘要、发生时间，以及经过 allowlist 生成的管理端业务路由。响应不包含 OpenID、手机号、对象存储地址、消息载荷、支付标识、错误码或 provider 返回内容。该只读列表仍只展示最近的异常，查询最大返回 100 条，默认返回 50 条，不提供历史翻页；投递复核列表使用上文独立的稳定游标合同。

异常中心的类型和状态筛选由服务端白名单校验。客户端展示的 capability 只控制入口可见性，服务端仍会对每次请求重新鉴权。
