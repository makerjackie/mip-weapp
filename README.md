# MIP 产品仓库

MIP 的会员与城市分会产品仓库。根目录是微信小程序主工程，`admin-web/` 是独立构建和部署的 React 管理后台；两端共同使用 CloudBase 服务端和 MySQL 追加迁移。

## 包含能力

- 微信身份、个人档案与城市分会
- 会员方案、权益、统一订单（会员与付费活动）
- 微信支付（下单、查单、回调、退款）
- 活动列表、报名、邀请、签到、心动与反馈
- 机会广场、六类合作卡和超级案例
- 公开档案举报、用户屏蔽与隐私管理
- 成长记录、任务卡、勋章、团队赛季与排行榜
- 站内消息与微信通知适配
- AI 文字与语音草稿适配
- 小程序运营管理分包与可复用服务端 API
- 110 条小程序路由、16 个核心 `mip-*` CloudBase 函数和 56 个锁定的 MySQL 迁移；支付启用时另有 `mip-cloudpay` / `mip-cloudpay-callback` / `mip-refund-worker`

## 五分钟开始

```bash
git clone git@github.com:douglas-ou/mip-minip-dev.git mip-weapp
cd mip-weapp
pnpm install
pnpm setup
pnpm dev:open
```

仓库默认使用 `touristappid`。没有 CloudBase 和支付商户号时也可以打开浏览；首页会显示「会员服务尚未配置」，**不会**假装已经登录或支付成功。

## 配置

1. 改品牌：`src/config/brand.ts`，或 `pnpm project:init --name "产品名"`
2. 配置 AppID：把 `.env.local` 的 `MINI_PROGRAM_APP_ID` 换成真实 `wx` AppID，再 `pnpm setup:local`
3. 配置 CloudBase：填写 `CLOUDBASE_ENV_ID`，见 [docs/CLOUDBASE.md](docs/CLOUDBASE.md)
4. 配置支付：`MIP_PAYMENT_MODE` 与商户绑定，见 [docs/WECHAT_PAY.md](docs/WECHAT_PAY.md)
5. 初始化 MIP `mip_*` 数据库与 `mip-*` 云函数：见下方上线步骤。

真实 AppID、EnvID、商户号只放 `.env.local` 和被忽略的 `project.private.config.json`。

## 演示模式与真实模式

- 未填 `CLOUDBASE_ENV_ID`：云能力关闭，界面明确未配置
- `MIP_PAYMENT_MODE=disabled`：支付按钮不可用
- `test` / `live`：服务端按模式隔离商品目录；缺商户配置时真实支付失败关闭

## AI 开发

先读 [AGENTS.md](AGENTS.md)。按任务加载 `.agents/skills/`：领域改动用 `mip-membership-domain`，支付用 `wechat-pay`，部署用 `mip-operations`。

## 验收

```bash
pnpm verify
pnpm admin:web:verify
pnpm verify:all
```

当前工作区对应的 16 个核心 CloudBase 函数已部署，最新 `cloud:verify` 通过。小程序开发者工具运行报告通过 110/110 路由、6/6 代表状态和 6/6 交互旅程，运行时诊断和 IDE 编译失败均为 0；375×724 为开发者工具视口，不是真机证据。React 生产环境已通过 14/14 路由的登录态读取验证。真机支付、手机号、订阅消息和扫码签到不能用开发者工具代替。

## 品牌与可替换配置

```bash
pnpm project:init --name "新产品名" --namespace mip
```

颜色、Logo、协议入口集中在 `src/config/brand.ts` 与 `src/app.css`。细节见 [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md)。

## 上线

1. 完成仓库外逻辑备份后执行 `pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --backup-manifest=/absolute/path/to/manifest.json`
2. 运行 `pnpm project:init` 生成环境专属 runtime 用户，再执行 `pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-user>` 收敛精确表级权限
3. 在 `.env.local` 明确设置 `MIP_DEPLOYMENT_STAGE=development|test|staging|production`，执行 `pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-user>`；production 必须追加 `--confirm-production`
4. 配置支付并执行 `pnpm cloud:deploy-payment -- --confirm-env=<EnvID> --confirm-function=mip-cloudpay --confirm-callback=mip-cloudpay-callback --confirm-refund=mip-refund-worker`；`MIP_PAYMENT_MODE=live` 时追加 `--confirm-live`
5. 执行 `pnpm admin:bootstrap -- --confirm-env=<EnvID> --confirm-owner` 配置首个 owner
6. 仅在 development/test 环境需要演示数据时执行 `pnpm seed:demo -- --confirm-env=<EnvID> --confirm-demo`
7. 运营后台：小程序内进入 `packages/admin/dashboard`

必须真机完成：手机号授权、真实支付、订阅消息、扫码签到。详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
