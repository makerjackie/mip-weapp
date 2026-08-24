# MCP

- 编辑器：`.mcp.json` 与 `.cursor/mcp.json` 通过 `scripts/mcp/weapp-vite.mjs` 启动 weapp-vite。路径相对当前仓库。
- CloudBase：`config/mcporter.json`，由脚本调用，不要在编辑器里再挂一份。
- 管理凭证只使用本机 `.env.local` 的环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`，不依赖本地设备登录状态，不进仓库。不要用前端 `publish_key`。

```bash
pnpm mcp:doctor
pnpm cloud:status
```

`pnpm cloud:status` 与 `pnpm cloud:auth` 都会显式验证 API Key；缺 Key 直接失败，正常流程不发起设备码。维护者应急入口仅为 `pnpm cloud:auth:device -- --allow-device-auth`。详见 [CLOUDBASE.md](CLOUDBASE.md)。

weapp-vite MCP 不要隐式 auto-start。构建时设置 `WEAPP_VITE_MCP=0`。
