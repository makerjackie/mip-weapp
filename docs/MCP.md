# MCP

- 编辑器：`.mcp.json` 与 `.cursor/mcp.json` 通过 `scripts/mcp/weapp-vite.mjs` 启动 weapp-vite。路径相对当前仓库。
- CloudBase：`config/mcporter.json`，由脚本调用，不要在编辑器里再挂一份。
- 凭证走本机 `.env.local` 的环境级 `CLOUDBASE_API_KEY` 与 CloudBase 登录状态，不进仓库。不要用前端 `publish_key`。

```bash
pnpm mcp:doctor
pnpm cloud:status
```

配好 API Key 后应为 READY，不必扫码。`pnpm cloud:auth` 这时只会加载密钥。详见 [CLOUDBASE.md](CLOUDBASE.md)。

weapp-vite MCP 不要隐式 auto-start。构建时设置 `WEAPP_VITE_MCP=0`。
