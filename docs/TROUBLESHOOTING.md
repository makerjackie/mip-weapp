# 故障排查

先区分本地静态门禁、CloudBase 部署证据和微信真机/生产证据。一个层级通过，不能代替另一个层级。

| 现象或错误 | 排查与处理 |
| --- | --- |
| 启动后仍显示 `touristappid` | 在 `.env.local` 配置有效 `MINI_PROGRAM_APP_ID`，运行 `pnpm setup:local`；`project.config.json` 的默认 `touristappid` 是浏览 UI 的安全默认值。 |
| `CLOUDBASE_API_KEY` 未生效或 MCP 未授权 | 确认环境级 API Key 与 `CLOUDBASE_ENV_ID` 同时写在项目根 `.env.local`，再运行 `pnpm cloud:auth` 或 `pnpm cloud:status`；两者都只验证 API Key，缺 Key 直接失败。不要把 `publish_key` 当管理密钥。维护者只有在 API Key 通道不可用且明确需要救援时，才运行 `pnpm cloud:auth:device -- --allow-device-auth`。 |
| `you are not authorized to perform operation (scf:CreateFunction)` | MCP 已连通，但当前临时 STS 没有原始 SCF 管控面权限。不要给 `TCB_QcsRole` 添加 `scf:CreateFunction`，也不要先推断 VPC 权限；升级到仓库固定的 MCP 版本，经明确授权运行 `pnpm cloud:auth:device -- --allow-device-auth`，再用 `CLOUDBASE_AUTH_MODE=local` 执行部署和验收。若资源主账号仍被拒绝，保留 RequestId 提交 CloudBase 工单。 |
| 部署提示 `CloudBase MySQL VPC/subnet is unavailable` | 当前 MCP 的 `getInstanceInfo` 只返回生命周期字段。部署脚本会在缺少显式网络配置时调用 `getConnectionInfo` 并只提取真实 `VpcId`/`SubnetId`；不要猜测网络 ID，也不要把完整连接载荷打印或写入仓库。 |
| 部署提示 `MIP deployment requires AppID and --confirm-env=<exact CLOUDBASE_ENV_ID>` | 检查 `MINI_PROGRAM_APP_ID`、`CLOUDBASE_ENV_ID` 和命令行 `--confirm-env` 完全一致；不要猜测或切换目标环境。 |
| 部署提示缺少 MIP 表 | 先运行 `pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run`，确认 lock 文件和迁移范围，再按数据库备份流程应用迁移。不要补建 `member_*` 表。 |
| `Runtime account missing grant` / `schema-level ALL PRIVILEGES` | 运行时账号必须是环境专属 `mip_*` 用户。运行 `pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>` 收敛并复核 `mip_*` 表逐表权限；命令会拒绝 schema/global 权限和不精确授权，审计及流水等追加事实不授予无业务需要的更新或删除权限。 |
| 部署产物出现非 MIP 函数或找不到 `mip-*` | 检查 `scripts/lib/mip-function-manifest.mjs` 和部署产物，只允许 16 个核心 `mip-*`，其中游戏化服务为 `mip-game-api`；支付另查 `mip-cloudpay`、`mip-cloudpay-callback`、`mip-refund-worker`。共享环境中的其他函数不由本仓库部署。 |
| 赛季页返回 `MEMBERSHIP_REQUIRED` | 团队 PK、赛季、排行榜和队伍大本营只对当前有效会员开放。检查 ledger 已确认的 `mip_membership_entitlements`，不要用客户端会员标记或支付调起结果绕过。 |
| 游戏化接口返回 `SCORE_NOT_ACCEPTED` | 客户端请求中包含了 score/points 等分数字段。移除这些字段；周赛结算和排行榜快照只允许 `mip-game-api` 从当前 AppID 的服务端成长流水与账户事实生成。 |
| 消息页提示无权调用 `mip-notification-worker` | 客户端只能调用 `mip-notifications-api`。检查构建配置中的 `MIP_NOTIFICATIONS_FUNCTION_NAME`，再重新部署并运行云端验收；不要开放 worker 的客户端权限。 |
| worker 触发 MySQL 资源持续增长 | 检查 CloudBase 定时触发器，删除 `mip-notification-every-5m`、`mip-outbox-every-5m`、`mip-refund-every-5m` 或其他高频 timer。三个 worker 都只保留函数，由受控内部调用触发。 |
| `mip_outbox_events` 长时间停留在 `PENDING` / `FAILED` | 先检查核心函数健康与 HMAC 配置，再运行 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10`。重试耗尽或未知事件会进入 `CANCELLED`，原因写入 `last_error_code` 和系统审计。 |
| 保存定时消息后返回 `MESSAGE_SCHEDULE_AUTOMATION_UNVERIFIED`，或进程在数据库提交后、scheduler 调用前中断 | 数据库计划可能已经提交；这两个步骤不是原子事务。不要换请求标识，使用同一幂等请求重试。检查 `mip-message-scheduler` 的专用角色、128 MB 预留并发、异步重试、固定 `$DEFAULT` trigger 和 canary 回读；必要时用 `pnpm message-campaigns:run-due` 恢复。 |
| scheduler 首次部署后提示函数已有但固定 trigger 缺失 | raw `CreateFunction` 可能成功后发生进程中断。先保留现场；只有部署脚本确认精确函数身份、专用角色、无 VPC、完整配置及当前源码 marker 全部一致时，才用原 `--start-canary` 命令追加 `--confirm-resume-missing-trigger=mip-message-scheduler`。不要手工创建 trigger，也不要对陌生或 marker 不匹配的函数使用恢复确认。 |
| 页面显示“会员服务尚未配置”或支付按钮不可用 | 检查 EnvID 和 `MIP_PAYMENT_MODE`。`disabled` 是关闭状态；未配置真实商户时必须失败关闭，不能用本地 UI 通过冒充支付成功。 |
| `PAYMENT_MODE_MISMATCH` / `PAYMENT_CONFIG_REQUIRED` | 确认会员订单的方案目录阶段与 `MIP_PAYMENT_MODE` 匹配（`TEST`/`LIVE`），并检查商户号、回调函数、EnvID、AppID 配置。真实支付需 `--confirm-live` 和生产配置。 |
| `wx.requestPayment` 成功但订单仍待确认 | 这是预期状态。等待 `mip-cloudpay-callback` 或权威查单；只有 `mip_orders.status=PAID` 才发放权益或完成付费活动报名。 |
| `PAYMENT_QUERY_MISMATCH` / 回调被拒绝 | 不要重试修改客户端金额。核对订单商户单号、provider transaction ID、AppID/OpenID、金额和 CNY 货币是否与 `mip_orders` 一致；查看回调验签和幂等记录，不打印原始支付凭证。 |
| 退款长时间停留在 `PENDING` / `PROVIDER_CREATED` / `PROCESSING` | 先检查 `mip-refund-worker`、ledger、商户配置和 HMAC，再运行 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。命令只按退款 ID 回查服务端金额；`failed>0` 时修复故障后重复执行。 |
| AI 终态语音长时间处于 `READY` / `PENDING` | 运行 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10`。`PENDING` 是非公开删除租约；`failed>0` 时检查存储配置并在租约到期后重试，不要恢复为 `READY`。 |
| 付费活动报 `EVENT_SEAT_HOLD_EXPIRED` | 订单对应的 `mip_event_seat_holds` 已过期或已被消耗。不要手工改报名为已注册；按 ledger 的退款/重试状态处理。 |
| `FORBIDDEN`、分会活动不可编辑 | 当前城市不是权限。检查服务端 capability、`mip_admin_role_bindings` 的 scope 和活动/分会关系；页面菜单不能授予管理权限。 |
| 活动签到或编辑报冲突 | 先刷新活动和报名的服务端版本，携带新的 `expectedVersion` 重试；不要覆盖更新，也不要删除 `ATTENDED` 历史。 |
| 手机号、支付、订阅消息或扫码在开发者工具正常但真机失败 | 这些能力必须按 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md) 在真机/生产验证；静态测试不能证明微信权限、商户回调或模板授权。 |
| `pnpm docs:check` 失败 | 运行 `pnpm docs:check` 查看失效链接，修正相对路径或文件名；它只检查文档链接，不代表云端、支付或真机通过。 |
| 类型检查找不到 weapp-vite tsconfig / 构建缺页 | 先 `pnpm install` 运行 postinstall，再检查 `src/app.json`、页面文件和分包路径是否成套；最后运行 `pnpm verify:build`。 |

## 最小复核顺序

```bash
pnpm docs:check
pnpm verify:source
pnpm verify:server
pnpm verify
git diff --check
```

涉及共享环境时，再按 [CLOUDBASE.md](CLOUDBASE.md)、[DATABASE.md](DATABASE.md) 和 [DEPLOYMENT.md](DEPLOYMENT.md) 保留备份、迁移、函数健康、最小权限和无高频 timer 的证据。涉及支付、手机号、订阅消息、扫码签到或 AI 录音时，保留真机/生产证据，不把本地结果写成已完成。
