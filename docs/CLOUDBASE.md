# CloudBase

- EnvID 只写 `.env.local` 的 `CLOUDBASE_ENV_ID`。不要把原项目生产环境写进仓库。
- 小程序端通过 `createCloudbaseRuntime` 初始化；未配置时 mode=`disabled`。
- 业务函数：`membership-api`、`membership-admin-api`、`membership-cloudpay`、`membership-cloudpay-callback`、`membership-payment-ledger`、`membership-notification-worker`。
- MySQL 连接串只进函数配置。

## MCP 授权

CloudBase 管理命令只使用环境级 API Key，不接受前端 `publish_key` 或已有设备登录作为正常管理凭证。短期票过期后，MCP 用这把密钥自己换新票，不依赖 30 天刷新票，也不绑网卡 MAC。

1. 打开 [云开发控制台 → 环境 → API Key 管理](https://tcb.cloud.tencent.com/dev#/env/apikey)
2. 建一把环境级 `api_key`
3. 与环境 ID 一起写进被忽略的项目根目录 `.env.local`：

```bash
CLOUDBASE_API_KEY=你刚创建的密钥
CLOUDBASE_ENV_ID=你的环境ID
```

`CLOUDBASE_ENV_ID` 已经有就不用改。密钥只放本机，不要提交。

```bash
pnpm cloud:status    # 显式验证 API Key，成功后为 READY
pnpm cloud:auth      # API Key-only；缺配置或验证失败时直接失败
pnpm database:setup -- --confirm-env=<EnvID>
pnpm cloud:deploy -- --confirm-env=<EnvID>
```

旧设备登录即使仍显示 READY，也不能替代本项目 API Key 验证。正常鉴权、状态检查、部署与诊断都不得调用 `start_auth`。只有维护者排障时可显式运行 `pnpm cloud:auth:device -- --allow-device-auth`；这是应急兜底，不是初始化步骤。恢复后仍应创建或更换环境级 API Key。

同主体共享环境时才填写 `CLOUDBASE_RESOURCE_APP_ID`。详见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
