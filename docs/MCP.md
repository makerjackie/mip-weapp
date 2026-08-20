# MCP

- 编辑器：`.mcp.json` 与 `.cursor/mcp.json` 通过 `scripts/mcp/weapp-vite.mjs` 启动 weapp-vite。路径相对当前仓库。
- CloudBase：`config/mcporter.json`，由脚本调用，不要在编辑器里再挂一份。
- 凭证走本机 CloudBase 登录状态与环境变量，不进仓库。

```bash
pnpm mcp:doctor
pnpm cloud:doctor
```

weapp-vite MCP 不要隐式 auto-start。构建时设置 `WEAPP_VITE_MCP=0`。
