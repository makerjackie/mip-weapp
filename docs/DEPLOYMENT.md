# Deployment

从临时 AppID 切换到正式 MIP AppID 时，先准备空的新 CloudBase/MySQL 环境，再执行 [AppID 身份迁移](IDENTITY_MIGRATION.md) 中的备份、应用范围复制和身份衔接流程。当前 schema 不支持在同一个数据库中保留旧 AppID 数据并复制同主键的新 AppID 副本。正常开发与部署保持 `MIP_UNION_ID_REBIND_ENABLED=false`。

1. 在 `.env.local` 配置 AppID、CloudBase EnvID、允许的 AppID 和 MIP runtime 配置。
2. 首次部署运行 `pnpm secrets:init -- --confirm-env=<EnvID>`，并把 `.env.local` 纳入私密凭证备份。命令先校验已部署函数，不打印密钥，也不会修改云资源。
3. 对共享环境做仓库外逻辑备份，预览 `mip_` 迁移范围：`pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run`。
4. 应用通过校验的 MIP 迁移：`pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --backup-manifest=/absolute/path/to/manifest.json`。
5. 仅在 development/test 环境需要占位目录时执行 `pnpm seed:demo -- --confirm-env=<EnvID> --confirm-demo`；生产环境不得运行 demo seed。
6. 先运行 `pnpm project:init` 生成环境专属 runtime 账号，再部署并验收 13 个核心 `mip-*` 函数：`pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>`。部署脚本会拒绝归属无法证明或持有跨项目权限的同名账号，显式开放已登录客户端可调用的 API、关闭 ledger 与 worker 的客户端权限，并确认通知与 outbox worker 都没有高频 timer。
7. 配置支付后，执行 `pnpm cloud:deploy-payment -- --confirm-env=<EnvID> --confirm-function=mip-cloudpay --confirm-callback=mip-cloudpay-callback --confirm-refund=mip-refund-worker` 部署三个支付函数；`MIP_PAYMENT_MODE=live` 时必须追加 `--confirm-live`，测试/生产目录和商户配置必须隔离。
8. 执行 `pnpm admin:bootstrap -- --confirm-env=<EnvID> --confirm-owner` 配置首个 owner；有多个候选资料时追加 `--user-id=<用户 UUID>`，demo 身份会被拒绝。
9. 部署后或发现 outbox 积压时，运行 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10` 做一次受控处理；退款停留在活动状态时，运行 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。两个命令都读取已部署函数配置完成 HMAC 调用，不打印密钥。
10. 微信后台配置服务器域名、业务域名、用户隐私协议，完成上传与提审。

`MIP_AGREEMENTS_JSON` 留空时四个受保护服务共同使用仓库默认协议版本；替换正式协议时，必须一次性提供同一份非空 JSON 数组。部署脚本会把它同时注入 `mip-identity-api`、`mip-commerce-api`、`mip-opportunities-api` 和 `mip-admin-api`，避免客户端展示版本与服务端门禁版本漂移。

迁移若报告 `uncertain DDL step`，表示数据库可能已执行该语句，但 journal 未能确认。停止后续部署，保留日志和备份，先恢复变更前备份或人工核对结构；不得直接重跑迁移，也不得手工把 `RUNNING` 改成 `APPLIED`。

管理导出使用 CloudBase 私有存储和短期下载地址。默认 `MIP_EXPORT_MAX_ROWS=5000`、`MIP_EXPORT_MAX_BYTES=8388608`；不要将导出对象设为公开读取。

媒体孤儿清理使用 `pnpm media:cleanup -- --confirm-env=<EnvID> --confirm-media=mip-media-api --minimum-age-hours=24 --limit=10`。该命令读取已部署函数的维护密钥完成受控调用，不打印密钥；默认不创建定时器，也不得用高频触发器代替人工批处理。

AI 私有语音 TTL 清理使用 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10`。该命令从已部署 AI 函数读取内部 HMAC，在确认的环境和 AppID 范围内分批处理，只输出状态和数量；不打印 AppID、用户、草稿、文件或密钥，不创建定时器。

发布前：`pnpm verify`、`pnpm docs:check`、`git diff --check`。真实支付、手机号、订阅消息、扫码签到和 AI 录音仍需真机/生产证据，见 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md)。未来迁移到独立 AppID/环境时只迁移经过校验的 `mip_*` 与 `mip/` 资源。
