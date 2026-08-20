# Troubleshooting

| 现象 | 处理 |
| --- | --- |
| 打开后仍是 touristappid | 配置 `.env.local` 后运行 `pnpm setup:local` |
| 类型检查找不到 weapp-vite tsconfig | 先 `pnpm install`（postinstall 会 `wv prepare`） |
| 云函数报未授权 | `pnpm cloud:status`，再按需 `pnpm cloud:auth` |
| 支付按钮不可用 | `MEMBERSHIP_PAYMENT_MODE` 仍是 `disabled` |
| MCP doctor 失败 | 确认没有绝对路径，且 `pnpm install` 已完成 |
| 构建产物缺页 | 看 `src/app.json` 与页面文件是否成套 |

更多命令见根 [README.md](../README.md)。
