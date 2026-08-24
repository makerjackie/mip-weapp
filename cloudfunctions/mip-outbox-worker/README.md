# mip-outbox-worker

本函数领取 `mip_outbox_events`，基于服务端业务表重建接收者和当前事实，再通过 HMAC 内部调用投影站内消息和成长事件。Outbox payload 中的用户字段不作为身份或权限事实。

`operations.notification_published` 只从 app-scoped `mip_operations_messages` 重建收件人、正文、活动目标和 `EVENT_REMINDER` 字段。发布事实由 `mip-admin-api` 按活动权限和当前确认参与者在同一事务生成；本 worker 只负责投影，不接受运营端收件人或文案输入。

`event.updated` 只在对应 `mip_event_changes` 仍是活动当前版本、活动已经发布且时间、地点或参与规则等实质字段发生变化时生成站内通知。`event.status_changed` 对下架、取消和结束生成站内通知；`event.published` 不生成通知，首次发布不会被误报为活动变更。活动标题、状态和收件人均按 `app_id` 回查业务表，payload 中的用户、标题和正文不参与投影。

活动内容、下架和结束通知覆盖仍与活动存在有效关系的报名状态，包括待审核、候补、待支付、已确认、退款处理中和已签到。活动取消在同一事务把受影响报名改为取消或退款处理中；整场活动通知按同一取消时间统一投影，报名级取消事件不再重复通知。用户主动取消仍保留报名级通知。用户屏蔽关系不影响活动交易和履约通知。每条消息的 dedupe key 同时绑定 outbox id 和收件人，部分投递失败后可按现有退避机制安全重试。

这些自动变更通知是站内消息，不依赖微信订阅模板；模板未配置时仍可写入站内信，并使用活动详情作为跳转目标。

签到和撤销从 `mip_event_checkin_transitions` 回查用户、活动、版本和冲销关系，内部成长调用只传 transition id。已撤销的签到不再发成功通知；成长服务仍处理该 transition，使先签到后撤销、先撤销后 worker 和重试都收敛到同一账本结果。

`runBatch` 仅接受带 `MIP_OUTBOX_HMAC_SECRET` 的受控调用。函数使用 MySQL 8 `FOR UPDATE SKIP LOCKED` 和 `lease_expires_at` 乐观租约；失败按 `available_at` 指数退避，达到五次后转为 `CANCELLED` 并追加系统审计。未知事件也转为 `CANCELLED` 并记录 `OUTBOX_EVENT_UNSUPPORTED`，不会无限重试。

默认不配置定时触发器。由运营命令显式恢复积压：

```bash
pnpm outbox:run -- --confirm-env=<EnvID> --limit=10
```

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_OUTBOX_HMAC_SECRET`、`MIP_NOTIFICATION_FUNCTION_NAME`、`MIP_NOTIFICATION_HMAC_SECRET`、`MIP_GROWTH_FUNCTION_NAME`、`MIP_GROWTH_HMAC_SECRET`、`MIP_DB_CONNECTION_URI`。
