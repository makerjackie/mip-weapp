# Getting started

1. Node 22（`.nvmrc`）与 pnpm 11。
2. `pnpm install`
3. `pnpm setup` 从 `.env.example` 创建 `.env.local`
4. `pnpm dev:open`

`project.config.json` 使用 `touristappid`。填入真实 `MINI_PROGRAM_APP_ID` 后再运行 `pnpm setup:local`。

没有 `CLOUDBASE_ENV_ID` 时可以浏览 UI，首页会提示会员服务尚未配置。使用 CloudBase 管理命令前，必须在 `.env.local` 同时写入环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`，然后运行 `pnpm cloud:status`。

下一步：[CUSTOMIZATION.md](CUSTOMIZATION.md)、[CLOUDBASE.md](CLOUDBASE.md)、[WECHAT_PAY.md](WECHAT_PAY.md)。
