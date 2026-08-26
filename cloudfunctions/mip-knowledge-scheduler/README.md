# MIP knowledge scheduler

`mip-knowledge-scheduler` 是不连接 MySQL、不可由小程序客户端调用的热点采集调度函数。它只管理自身固定的 `mip-knowledge-ingestion-next` 滚动单次 timer，并通过专用 HMAC 调用 `mip-admin-api` 读取权威计划和处理到期来源。

- 每次最多领取 3 个来源；每个来源失败最多重试 3 次，耗尽后顺延到下一次本地日计划。
- 没有有效计划时关闭 timer，不创建高频轮询或占位 timer。
- 运行时不得配置 `MIP_DB_CONNECTION_URI` 或 VPC；MySQL 租约、去重、采集记录和审核中内容全部由 `mip-admin-api` 提交。
- 来源内容强制保存为 `HOT_NEWS + FREE + PENDING_REVIEW + PENDING`，不能由 feed 或调度函数改写为已发布内容。
- 来源请求继续使用管理 API 的精确 host allowlist、私网与 DNS rebinding 拒绝、10 秒超时、解压后 2 MB 和 50 条上限。
- timer 参数包含 namespace、函数、trigger、UTC fireAt、generation、activation generation、用途和签名；普通 reconcile 在 canary 未激活时 fail closed。
