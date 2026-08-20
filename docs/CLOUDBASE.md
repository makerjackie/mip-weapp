# CloudBase

- EnvID 只写 `.env.local` 的 `CLOUDBASE_ENV_ID`。不要把原项目生产环境写进仓库。
- 小程序端通过 `createCloudbaseRuntime` 初始化；未配置时 mode=`disabled`。
- 业务函数：`membership-api`、`membership-admin-api`、`membership-cloudpay`、`membership-cloudpay-callback`、`membership-payment-ledger`、`membership-notification-worker`。
- MySQL 连接串只进函数配置。

## MCP 授权

推荐使用环境级 API Key，不要用前端 `publish_key`。短期票过期后，MCP 用这把密钥自己换新票，不再依赖 30 天刷新票，也不绑网卡 MAC。

1. 打开 [云开发控制台 → 环境 → API Key 管理](https://tcb.cloud.tencent.com/dev#/env/apikey)
2. 建一把环境级 `api_key`
3. 写进被忽略的项目根目录 `.env.local`：

```bash
CLOUDBASE_API_KEY=你刚创建的密钥
```

`CLOUDBASE_ENV_ID` 已经有就不用改。密钥只放本机，不要提交。

```bash
pnpm cloud:status    # 配好后应变成 READY，不用扫码
pnpm cloud:auth      # 有 API Key 时只加载密钥，不会再开设备码
pnpm database:setup -- --confirm-env=<EnvID>
pnpm cloud:deploy -- --confirm-env=<EnvID>
```

没有 API Key 时，才用 `pnpm cloud:auth` 走设备码。同主体共享环境时才填写 `CLOUDBASE_RESOURCE_APP_ID`。详见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
