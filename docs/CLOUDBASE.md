# CloudBase

- EnvID 只写 `.env.local` 的 `CLOUDBASE_ENV_ID`。不要把原项目生产环境写进仓库。
- 小程序端通过 `createCloudbaseRuntime` 初始化；未配置时 mode=`disabled`。
- 业务函数：`membership-api`、`membership-admin-api`、`membership-cloudpay`、`membership-cloudpay-callback`、`membership-payment-ledger`、`membership-notification-worker`。
- MySQL 连接串只进函数配置。

```bash
pnpm cloud:doctor
pnpm cloud:auth          # 仅当未授权
pnpm database:setup -- --confirm-env=<EnvID>
pnpm cloud:deploy -- --confirm-env=<EnvID>
```

同主体共享环境时才填写 `CLOUDBASE_RESOURCE_APP_ID`。详见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
