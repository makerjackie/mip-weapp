# CloudBase 运行边界

MIP 短期复用共享 CloudBase 环境，但在函数、数据库、对象存储和运行时账号上建立独立边界。真实 AppID、EnvID、MySQL URI、商户凭证和内部密钥只放本机 `.env.local` 或 Cloud Function 环境变量，不进入仓库。

## 部署清单

普通业务部署固定为 13 个核心函数：

| 函数 | 责任 | 客户端可直接调用 |
| --- | --- | --- |
| `mip-identity-api` | 身份、协议、手机号、用户档案、账号注销 | 是 |
| `mip-media-api` | 图片解码、内容安全、隔离存储和素材登记（含活动相册） | 是 |
| `mip-events-api` | 活动、报名、邀请、签到、心动、反馈和活动相册 | 是 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、超级案例 | 是 |
| `mip-community-api` | 公开档案举报、屏蔽关系和个人屏蔽列表 | 是，受身份补全约束 |
| `mip-commerce-api` | 会员方案、统一订单、退款申请、订单查询 | 是 |
| `mip-admin-api` | 管理分包、分会、活动与相册运营、审计、导出 | 是，受 capability 约束 |
| `mip-growth-api` | 成长等级、规则、账户和流水 | 是；内部事件也可调用 |
| `mip-ai-api` | 语音、转写和结构化草稿 | 是；provider 回调走内部鉴权 |
| `mip-notifications-api` | 站内消息读取、已读状态和订阅授权选择 | 是，仅处理当前用户数据 |
| `mip-payment-ledger` | 支付、退款和权益事务事实 | 否，仅内部 HMAC 调用 |
| `mip-notification-worker` | 站内消息写入和可选订阅消息投递 | 否，仅内部 HMAC 调用 |
| `mip-outbox-worker` | 业务事件领取、站内消息与成长投影 | 否，仅内部 HMAC 调用 |

启用真实支付时，另外部署 `mip-cloudpay`、`mip-cloudpay-callback` 和 `mip-refund-worker`。它们是下单/查单适配器、回调入口和退款提交/恢复 worker，不计入 13 个核心函数；适配器不持有 MySQL 连接串，通过 HMAC 调用 `mip-payment-ledger`。退款 worker 另用 `MIP_REFUND_WORKER_HMAC_SECRET` 接受管理 API 和受控运营命令调用。

`cloudfunctions/membership-*` 目录是迁移期间保留的历史实现，当前运行时不部署、不新增业务，也不能作为 MIP 的部署目标。部署脚本和云端验收只接受直接的 `mip-*` 源码与函数名。

## 数据和存储

- 新业务只使用 `mip_*` 表，迁移记录写入 `mip_schema_migrations`；`database/mysql/mip/migrations.lock.json` 是迁移顺序、校验和和表清单的权威来源。
- 订单统一使用 `mip_orders`：`order_type=MEMBERSHIP` 表示会员订单，`order_type=EVENT` 表示付费活动订单。不要为会员和活动再建立第二套订单事实。
- 对象存储 key 统一使用 `mip/` 前缀。数据库保存完整 `cloud://` 文件 ID、摘要、大小和业务外键，不保存临时 HTTPS URL。
- 图片只通过 `mip-media-api` 上传；函数完整解码并重新编码 PNG/JPEG，执行微信图片内容安全检查，再写入 `mip/<stage>/<appScope>/` 和 `mip_media_assets`。业务保存接口仍按 owner、状态和 purpose 验证素材，上传成功不能直接授予业务绑定。
- 活动照片使用独立 `EVENT_ALBUM` purpose 和 `mip/<stage>/<appScope>/event-album/` 存储目录。相册提交和批准发布都会重新校验可信媒体记录；客户端不能提交发布状态、上传者或对象 key。
- 共享环境中的旧 `member_*`、`dating_*`、`sewing_*` 表和对象保持只读，不迁移、不修复、不删除。

## 运行时最小权限

部署脚本使用由 CloudBase EnvID 派生的专用 MySQL runtime 账号，并在部署后读取权限表复核精确的 table→privilege 映射：不授予 schema-level `ALL PRIVILEGES`、全局权限或无业务需要的 `DELETE`；审计表只允许 `SELECT`、`INSERT`。脚本不会接管同名既有账号，也不会撤销其他 schema 的权限；发现账号归属或授权范围无法证明时会停止部署。函数通过 VPC 私网连接 MySQL，客户端永远拿不到连接串。

每个请求都使用可信 CloudBase 上下文解析 `app_id` 和用户身份。`MIP_ALLOWED_APP_IDS` 必须包含当前小程序 AppID；客户端传入的 AppID、用户 ID、金额、资格和权限都不能成为 ownership 或状态事实。

## 受控 worker

`mip-notification-worker`、`mip-outbox-worker` 和 `mip-refund-worker` 只保留函数，不安装高频定时触发器。`mip-notifications-api` 显式允许已登录小程序调用，三个 worker 与 payment ledger 显式禁止客户端调用；部署和云端验收会收敛并复核这些函数级权限。任何访问 MySQL 的 5 分钟级 timer 都会阻止 Serverless MySQL 自动暂停并产生持续 CCU 消耗。业务事实与 outbox 在同一事务提交；通知授权先由 reservation 短事务独占，实际微信调用和最终状态写入再由锁定 `ACTIVE` 用户的专用投递事务串行化，避免账号注销提交后继续发信。微信接收与 MySQL 提交仍是 at-least-once 外部边界，详见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。退款 worker 从 ledger 回查权威退款事实并使用不可变商户退款单号保证重试安全。积压由运营命令显式恢复：

```bash
pnpm outbox:run -- --confirm-env=<EnvID> --limit=10
pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10
```

AI 语音 TTL 不使用定时触发器。无人访问的过期或终态草稿通过 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 显式分批处理；维护 action 使用 AI 内部 HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，响应只返回状态与数量。

## 环境与授权

EnvID 只写项目根目录 `.env.local` 的 `CLOUDBASE_ENV_ID`。CloudBase MCP 统一从 `config/mcporter.json` 启动，优先使用环境级 `CLOUDBASE_API_KEY`，不要使用前端 `publish_key`。

```bash
pnpm cloud:status
pnpm cloud:auth
pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run
pnpm project:init
pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>
```

有 API Key 时 `pnpm cloud:status` 应为 `READY`，不需要扫码；没有 API Key 时才运行一次 `pnpm cloud:auth`。部署必须同时明确 `--confirm-env=<精确 EnvID>` 和环境专属 runtime 账号，不会自动授权、切换环境或处理其他项目的数据库账号。

## 未来迁移

短期共享环境只允许 MIP 资源按上述边界共存。未来切换到独立 AppID 或 CloudBase 环境时，只迁移经过备份和校验的 `mip_*` 数据、`mip/` 对象及 MIP 函数配置，然后重新绑定可信 AppID；不得把旧项目表或共享环境的默认权限一起迁移。

更多数据库和 MCP 说明见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
