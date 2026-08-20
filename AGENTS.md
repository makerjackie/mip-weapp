# AGENTS

这是独立的会员小程序产品模板，不是 Monorepo，也不是案例馆。根目录就是唯一的微信小程序。

## 1. 定位

保留会员、活动、订单、支付和运营后台，方便改品牌后上线。

## 2. 技术栈

原生 WXML + TypeScript + weapp-vite + Tailwind CSS 4 + weapp-tailwindcss 5 + TDesign MiniProgram。不要引入 React/Vue/Taro/uni-app。

## 3. 目录地图

- `src/pages` 主 Tab
- `src/packages/member` 用户端二级页
- `src/packages/admin` 运营端
- `src/modules/membership` 用户领域
- `src/modules/admin` 运营领域
- `src/platform` / `src/shared` 平台原语（已从共享包内联）
- `src/config` 品牌、功能开关、运行时
- `cloudfunctions` 与 `database/mysql` 服务端事实
- `.agents/skills` 任务技能

## 4. 常用命令

`pnpm setup` · `pnpm dev:open` · `pnpm verify` · `pnpm project:init` · `pnpm mcp:doctor`

## 5. 改代码前先读

1. 本文件
2. [DESIGN.md](DESIGN.md)
3. 任务对应文档：领域 [docs/MEMBERSHIP_DOMAIN.md](docs/MEMBERSHIP_DOMAIN.md)，支付 [docs/WECHAT_PAY.md](docs/WECHAT_PAY.md)，云 [docs/CLOUDBASE.md](docs/CLOUDBASE.md)

## 6. 边界

- 页面 → modules → platform/cloud functions
- 页面不得直接 `wx.cloud.init` 或 `wx.requestPayment`
- 云函数不得依赖仓库外路径

## 7. 配置和密钥

可提交：`.env.example`、`src/config/brand.ts`、`touristappid`
仅本地：`.env.local`、`project.private.config.json`、商户证书、MySQL URI

## 8. CloudBase

唯一通道 `config/mcporter.json`。先 `pnpm cloud:status`，未授权才 `pnpm cloud:auth`。

## 9. 微信支付

客户端只提交订单意图。金额、发货、退款由 ledger 与回调决定。`requestPayment` 成功不是权益生效。

## 10. 设计

[DESIGN.md](DESIGN.md)。品牌入口 `src/config/brand.ts`。

## 11. 测试和验收

`pnpm verify` 是静态门禁。UI 还要 `pnpm runtime:preflight`；支付/手机号要真机。

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

workspace 协议、案例馆、跨仓库相对脚本、提交密钥、用客户端决定服务端事实。

## 14. 完成前

```bash
pnpm verify
git diff --check
```

涉及支付或云资源时，写明哪些仍需真机/生产环境。

## 领域额外规则

- 会员、订单、活动资格不能由客户端计算
- 改数据库必须追加迁移
- 手机号、支付、订阅消息、扫码签到必须真机验证
