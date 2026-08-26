# MIP knowledge scheduler

`mip-knowledge-scheduler` 是不连接 MySQL、不可由小程序客户端调用的热点采集调度函数。它只管理自身固定的 `mip-knowledge-ingestion-next` 滚动单次 timer，并通过专用 HMAC 调用 `mip-admin-api` 读取权威计划和处理到期来源。

- 每次最多领取 3 个来源；每个来源失败最多重试 3 次，耗尽后顺延到下一次本地日计划。
- 没有有效计划时关闭 timer，不创建高频轮询或占位 timer。
- 运行时不得配置 `MIP_DB_CONNECTION_URI` 或 VPC；MySQL 租约、去重、采集记录和审核中内容全部由 `mip-admin-api` 提交。
- 来源内容强制保存为 `HOT_NEWS + FREE + PENDING_REVIEW + PENDING`，不能由 feed 或调度函数改写为已发布内容。
- 来源请求继续使用管理 API 的精确 host allowlist、私网与 DNS rebinding 拒绝、10 秒超时、解压后 2 MB 和 50 条上限。
- timer 参数包含 namespace、函数、trigger、UTC fireAt、generation、activation generation、用途和签名；普通 reconcile 在 canary 未激活时 fail closed。

## 部署边界

该函数不属于 16 个数据库核心函数，不能通过 `cloud:deploy` 或 CloudBase 普通函数创建入口部署。专用入口复用滚动单次 timer 的控制面实现，但使用独立函数名、trigger、CAM 角色和 `MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET`：

```bash
pnpm cloud:knowledge-scheduler:role -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-knowledge-scheduler \
  --confirm-role=<dedicated-knowledge-role> \
  --confirm-resource-uin=<resource-owner-uin>

pnpm cloud:knowledge-scheduler:deploy -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-knowledge-scheduler \
  --confirm-trigger=mip-knowledge-ingestion-next \
  --confirm-role=<dedicated-knowledge-role> \
  --confirm-timer-offset-minutes=<canaried-offset> \
  --start-canary
```

role 命令默认只预览，确认 policy 只有 `UpdateTrigger`、`ListTriggers`、`InvokeFunction` 后才追加 `--apply`。部署前必须先用核心部署把同一个函数名和 HMAC 注入 `mip-admin-api`。canary 到时后使用 `cloud:knowledge-scheduler:verify` 配合 `--expect-canary=<generation>` 验证固定 timer 已关闭，再用同一 generation 执行 `--activate-after-canary=<generation>`；最后不带 `--expect-canary` 复核 DISPATCH 状态。任何角色、VPC、环境变量、源码 marker、唯一 trigger、generation、预留并发、异步重试或客户端 `invoke=false` 回读不一致都会停止。

raw `CreateFunction` 成功但 trigger 尚未创建时，默认拒绝续跑。只有完整函数配置和当前源码 marker 精确匹配时，才可在原 canary 命令追加 `--confirm-resume-missing-trigger=mip-knowledge-scheduler`。production 命令还必须追加 `--confirm-production`。
