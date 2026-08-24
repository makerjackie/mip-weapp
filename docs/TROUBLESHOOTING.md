# Troubleshooting

| 现象 | 处理 |
| --- | --- |
| 打开后仍是 touristappid | 配置 `.env.local` 后运行 `pnpm setup:local` |
| 类型检查找不到 weapp-vite tsconfig | 先 `pnpm install`（postinstall 会 `wv prepare`） |
| 云函数报未授权 | 确认环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID` 同时写在项目根 `.env.local`，再运行 `pnpm cloud:auth` 或 `pnpm cloud:status`；两者都只验证 API Key，缺 Key 直接失败。不要用前端 `publish_key`。维护者只有在 API Key 通道不可用且明确需要救援时，才运行 `pnpm cloud:auth:device -- --allow-device-auth`。 |
| 支付按钮不可用 | `MEMBERSHIP_PAYMENT_MODE` 仍是 `disabled` |
| MCP doctor 失败 | 确认没有绝对路径，且 `pnpm install` 已完成 |
| 构建产物缺页 | 看 `src/app.json` 与页面文件是否成套 |

更多命令见根 [README.md](../README.md)。
