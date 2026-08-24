# MCP

- 编辑器：`.mcp.json` 与 `.cursor/mcp.json` 通过 `scripts/mcp/weapp-vite.mjs` 启动 weapp-vite。路径相对当前仓库。
- CloudBase：`config/mcporter.json`，由脚本调用，不要在编辑器里再挂一份。
- 环境和 MySQL 管理默认使用本机 `.env.local` 的环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`；不要用前端 `publish_key`。原始 SCF 管控面 action 被环境 API Key 的临时 STS 拒绝时，经明确授权改用本地 Device Flow。

```bash
pnpm mcp:doctor
pnpm cloud:status
```

`pnpm cloud:status` 与 `pnpm cloud:auth` 都会显式验证 API Key；缺 Key 直接失败，正常流程不发起设备码。维护者经明确授权使用 `pnpm cloud:auth:device -- --allow-device-auth`，后续管控面命令必须显式带 `CLOUDBASE_AUTH_MODE=local`。详见 [CLOUDBASE.md](CLOUDBASE.md)。

weapp-vite MCP 不要隐式 auto-start。构建时设置 `WEAPP_VITE_MCP=0`。
