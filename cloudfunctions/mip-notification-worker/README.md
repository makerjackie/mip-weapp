# mip-notification-worker

MIP 站内消息写入与微信补充通知投递函数。站内消息先落库并保持可回查；外部送达只消费用户真实授权，不改变业务事实。用户读取消息、标记已读和记录订阅授权选择统一走 `mip-notifications-api`。

本函数不开放客户端调用，也不配置定时触发器。`publishMessage` 与 `runDeliveryBatch` 只接受受控 HMAC 调用。

`MIP_SUBSCRIBE_TEMPLATES_JSON` 只配置实际已启用的模板。没有对应模板时仍写站内消息，不创建外部投递任务。`EVENT_REMINDER` 的逻辑字段合同为 `title`、`startsAt`、`location`；配置将实际模板关键词映射到这些字段，例如：

```json
{
  "EVENT_REMINDER": {
    "templateId": "template-id",
    "fields": {
      "title": "thing1",
      "startsAt": "time2",
      "location": "thing3"
    }
  }
}
```

授权按 AppID、用户、渠道和模板领取。worker 先用短事务把授权 `RESERVED` 到唯一任务；本地请求校验完成后，专用投递事务先锁定并确认用户仍为 `ACTIVE`，再锁定任务、授权和 reservation token，并让该用户行锁覆盖微信调用与最终状态写入。微信成功时授权和任务在同一事务收敛为 `CONSUMED` / `DELIVERED`；明确失败时在释放用户锁前写入退避状态，授权只允许原任务重试。投递事务禁用数据库自动重试，避免死锁恢复自动重复微信调用。账号注销与该用户行锁串行化，因此注销先提交时不会再调用微信，投递先开始时注销等待投递状态提交。

微信调用与 MySQL 无法组成同一原子事务。进程在微信接收后、投递事务提交前中断时，原任务恢复属于 at-least-once，可能重复调用。通知 worker 的 60 秒硬超时低于 120 秒任务租约；完整边界和处置见 [通知投递合同](../../docs/NOTIFICATIONS.md)。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_NOTIFICATION_HMAC_SECRET`、`MIP_NOTIFICATION_ENCRYPTION_KEY`、`MIP_SUBSCRIBE_TEMPLATES_JSON`、`MIP_MINIPROGRAM_STATE`、`MIP_DB_CONNECTION_URI`。
