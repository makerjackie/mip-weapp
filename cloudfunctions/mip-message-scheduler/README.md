# MIP message scheduler

`mip-message-scheduler` 是不连接 MySQL、不可由小程序客户端调用的调度函数。它只管理自身固定的 `mip-message-campaign-next` timer，通过内部 HMAC 调用 `mip-admin-api` 读取权威计划并处理到期活动。

- 运行时只需要 `scf:UpdateTrigger`、`scf:ListTriggers` 和 `scf:InvokeFunction`。CAM 不支持对 `InvokeFunction` 做资源级授权，policy resource 必须是 `*`；代码把调用目标固定为 `mip-admin-api`，并要求独立 HMAC 与 AppID allowlist。
- 部署流程使用 raw SCF `CreateFunction` 并在首个云端写入中直接绑定专用角色，避免 CloudBase 创建路径默认注入共享 `TCB_QcsRole`；部署流程同时负责固定 timer 和 128 MB 预留并发，运行时不创建或删除 trigger。
- raw 创建成功但 trigger 尚未创建时默认 fail closed；只有精确函数配置与当前源码 marker 完全一致，并显式确认 `--confirm-resume-missing-trigger=mip-message-scheduler` 的 `--start-canary` 才能从 0 trigger 续跑。
- timer 使用带年份的七段 cron，每次只指向最近一个计划；没有计划时关闭，不使用 2099 占位。
- 手动 `pnpm message-campaigns:run-due` 会先处理到期活动，再以独立 HMAC reconcile scheduler 并要求 `verified`，用于恢复未来计划唤醒和重试耗尽后的 re-arm。
- SCF cron 时区必须先通过固定 trigger canary 实测，再配置 `MIP_SCF_TIMER_UTC_OFFSET_MINUTES`，代码不假定时区。canary 打开或已关闭但尚未携 generation 激活时，普通 reconcile 会 fail closed；激活转换后会在后续 DISPATCH 消息中保留 canary generation，因此 reconcile 中途失败时可用同一 `--activate-after-canary` 命令续跑。
- 部署脚本把 timer 用户代码失败设置为重试 2 次、消息保留 3600 秒并执行 readback；运行时错误必须抛出。
