# mip-notification-worker

MIP 站内消息写入与微信补充通知投递函数。站内消息先落库并保持可回查；外部送达不改变业务事实。订阅消息消费逐次授权；客服消息只使用实际客服会话登记的 48 小时窗口；服务号通过受控 HTTPS adapter 投递。

本函数不开放客户端调用，也不配置定时触发器。`publishMessage`、`reconcileDeliveryTask` 与 `runDeliveryBatch` 只接受受控 HMAC 调用。`reconcileDeliveryTask` 只在证据版本匹配时收敛过期 `PROCESSING` 或读取既有失败事实，不调用外部 provider；`UNKNOWN` / `MANUAL_REVIEW` 不自动重放，也不会被伪造为 `DELIVERED`。

`MIP_SUBSCRIBE_TEMPLATES_JSON` 只配置实际已启用的模板。没有对应模板时仍写站内消息，不创建外部投递任务。`EVENT_REMINDER` 的逻辑字段合同为 `title`、`startsAt`、`description`、`location`；配置将实际模板关键词映射到这些字段，例如：

```json
{
  "EVENT_REMINDER": {
    "templateId": "template-id",
    "fields": {
      "title": "thing1",
      "startsAt": "time2",
      "description": "thing3",
      "location": "thing4"
    }
  }
}
```

授权按 AppID、用户、渠道和模板领取。worker 先用短事务把授权 `RESERVED` 到唯一任务；本地请求校验完成后，专用投递事务先锁定并确认用户仍为 `ACTIVE`，再锁定任务、授权和 reservation token，并让该用户行锁覆盖微信调用与最终状态写入。微信成功时授权和任务在同一事务收敛为 `CONSUMED` / `DELIVERED`；明确失败时在释放用户锁前写入退避状态，授权只允许原任务重试。投递事务禁用数据库自动重试，避免死锁恢复自动重复微信调用。账号注销与该用户行锁串行化，因此注销先提交时不会再调用微信，投递先开始时注销等待投递状态提交。

微信调用与 MySQL 无法组成同一原子事务。进程在微信接收后、投递事务提交前中断时，原任务恢复属于 at-least-once，可能重复调用。通知 worker 的 60 秒硬超时低于 120 秒任务租约；完整边界和处置见 [通知投递合同](../../docs/NOTIFICATIONS.md)。

服务号 adapter 使用 `MIP_SERVICE_ACCOUNT_ADAPTER_JSON` 配置 HTTPS endpoint 和允许的逻辑模板映射，以 `MIP_SERVICE_ACCOUNT_ADAPTER_SECRET` 对固定请求体签名。adapter 以任务 ID 作为幂等键，并负责把内部用户引用映射到服务号关注者；密钥和关注者标识不进入业务表或响应。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_NOTIFICATION_HMAC_SECRET`、`MIP_NOTIFICATION_ENCRYPTION_KEY`、`MIP_SUBSCRIBE_TEMPLATES_JSON`、`MIP_MINIPROGRAM_STATE`、`MIP_CUSTOMER_SERVICE_ENABLED`、`MIP_SERVICE_ACCOUNT_ADAPTER_JSON`、`MIP_SERVICE_ACCOUNT_ADAPTER_SECRET`、`MIP_DB_CONNECTION_URI`。
