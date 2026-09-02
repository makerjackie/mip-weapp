# AGENTS

这是 MIP 产品仓库。根目录仍是微信小程序主工程，`admin-web/` 是独立构建、独立部署的 React 管理后台；两端共同使用 `cloudfunctions`、`database/mysql` 和平台中立的服务端契约。

## 1. 定位

保留会员、活动、订单、支付和运营后台，方便改品牌后上线。

## 2. 技术栈

- 微信小程序：原生 WXML + TypeScript + weapp-vite + Tailwind CSS 4 + weapp-tailwindcss 5 + TDesign MiniProgram。`src/` 内不要引入 React/Vue/Taro/uni-app。
- Web 管理后台：`admin-web/` 使用 React + TypeScript + Vite + TanStack Router/Query + Ant Design；遵循 [admin-web/AGENTS.md](admin-web/AGENTS.md)。
- 平台中立共享契约：仅放在 `packages/`，不得为了复用展示代码提前拆包。

## 3. 目录地图

- `src/pages` 主 Tab
- `src/packages/member` 用户端二级页
- `src/packages/admin` 小程序现场工作台（仅 Web 登录确认、已授权活动、签到码与海报、名单与签到）
- `src/modules/mip-*` 用户与运营领域
- `src/modules/mip-admin` 运营领域
- `src/platform` / `src/shared` 平台原语（已从共享包内联）
- `src/config` 品牌、功能开关、运行时
- `admin-web` React Web 管理后台（独立构建与 Cloudflare Pages/Worker 部署）
- `packages/admin-contracts` 两端共用的 AdminRequest v1 中立契约
- `cloudfunctions` 与 `database/mysql` 服务端事实
- `.agents/skills` 任务技能

## 4. 常用命令

`pnpm setup` · `pnpm dev:open` · `pnpm verify` · `pnpm admin:web:dev` · `pnpm admin:web:build` · `pnpm admin:web:verify` · `pnpm verify:all`

## 5. 改代码前先读

1. 本文件
2. [docs/README.md](docs/README.md)，按权威关系定位任务文档
3. 任务对应文档：界面 [DESIGN.md](DESIGN.md)，领域 [docs/MEMBERSHIP_DOMAIN.md](docs/MEMBERSHIP_DOMAIN.md)，支付 [docs/WECHAT_PAY.md](docs/WECHAT_PAY.md)，云 [docs/CLOUDBASE.md](docs/CLOUDBASE.md)

## 6. 边界

- 小程序页面 → modules → platform/cloud functions
- Web 页面 → React adapter → modules/services → 同源 BFF → `mip-admin-api`
- 完整运营界面只进入 `admin-web/`；小程序不得新增现场白名单以外的管理页面
- 页面不得直接 `wx.cloud.init` 或 `wx.requestPayment`
- 云函数不得依赖仓库外路径
- `admin-web/` 不得引用 `wx`、WXML、TDesign MiniProgram 或 `src/pages` / `src/packages`。

## 7. 配置和密钥

可提交：`.env.example`、`src/config/brand.ts`、`touristappid`
仅本地：`.env.local`、`project.private.config.json`、商户证书、MySQL URI

## 8. CloudBase

唯一通道 `config/mcporter.json`。默认使用 `.env.local` 中的环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`；`pnpm cloud:status` 和 `pnpm cloud:auth` 只验证并加载 API Key，不发起设备码。

API Key 是日常通道，Device Flow 是部署高权限通道。只有创建、更新云函数等 SCF 控制面操作被 API Key 拒绝时，维护者才显式运行 `pnpm cloud:auth:device -- --allow-device-auth`，并以 `CLOUDBASE_AUTH_MODE=local` 执行该次部署。Device Flow 登录保存在本机并支持刷新，通常不需要每次部署重新授权；凭证过期、被撤销、主动退出、清理本机凭证或更换电脑/系统用户时才重新授权。

其他人使用本仓库时必须配置自己的 CloudBase 环境 ID 和 API Key；需要部署云函数时使用其有权访问目标环境的腾讯云账号完成 Device Flow。不得复制、提交或共享维护者的 API Key、Device Flow 登录文件或本机凭证。

不要给会访问 MySQL 的云函数挂高频定时触发器（例如每 5 分钟）。Serverless MySQL 大约空闲 10–30 分钟才会暂停；定时任务会一直把实例唤醒，按 CCU（核·小时）消耗资源点，个人版额度很快会被打满。通知 worker 只保留函数，默认不安装定时器。

## 9. 微信支付

客户端只提交订单意图。金额、发货、退款由 ledger 与回调决定。`requestPayment` 成功不是权益生效。

## 10. 设计

[DESIGN.md](DESIGN.md)。品牌入口 `src/config/brand.ts`。

## 11. 测试和验收

`pnpm verify` 只验证微信小程序与 CloudBase；`pnpm admin:web:verify` 独立验证 Web；`pnpm verify:all` 顺序执行两者。小程序 UI 还要 `pnpm runtime:preflight`；Web UI 要按 `admin-web/AGENTS.md` 验证桌面和手机视口；支付/手机号要真机。

## 12. Skill

| 任务       | Skill                   |
| ---------- | ----------------------- |
| 页面/工程  | `weapp-development`     |
| 视觉       | `weapp-design`          |
| 云开发     | `weapp-cloudbase`       |
| 支付       | `wechat-pay`            |
| 会员领域   | `mip-membership-domain` |
| 部署运营   | `mip-operations`        |
| 运行时验收 | `weapp-runtime-qa`      |

## 13. 禁止

案例馆、跨仓库相对脚本、提交密钥、用客户端决定服务端事实。只允许经过审查的平台中立契约使用 workspace package；页面、样式和运行时 adapter 不得为共享而抽包。

## 14. 完成前

```bash
pnpm verify
pnpm admin:web:verify
pnpm verify:all
git diff --check
```

涉及支付或云资源时，写明哪些仍需真机/生产环境。

## 领域额外规则

- 会员、订单、活动资格不能由客户端计算
- 改数据库必须追加迁移
- 手机号、支付、订阅消息、扫码签到必须真机验证
