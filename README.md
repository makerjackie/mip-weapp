# mip-weapp

完整的会员小程序产品模板。根目录就是微信小程序工程：克隆后安装依赖、打开微信开发者工具，即可基于现有会员、活动、订单、支付和运营能力改品牌上线。

## 适合谁

已经确定要做会员/活动/社群产品，希望保留现有业务闭环，而不是从空白模板重新实现支付和后台。

## 包含能力

- 用户登录与资料
- 会员商品、权益、订单
- 微信支付（下单、查单、回调、退款）
- 活动列表、详情、报名、凭证、签到
- 成员展示、关注、屏蔽、举报
- 公告与运营后台
- CloudBase 云函数 + MySQL

## 五分钟开始

```bash
git clone git@github.com:makerjackie/mip-weapp.git
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
4. 配置支付：`MEMBERSHIP_PAYMENT_MODE` 与商户绑定，见 [docs/WECHAT_PAY.md](docs/WECHAT_PAY.md)
5. 初始化会员商品 / 数据库 / 云函数：见下方上线步骤

真实 AppID、EnvID、商户号只放 `.env.local` 和被忽略的 `project.private.config.json`。

## 演示模式与真实模式

- 未填 `CLOUDBASE_ENV_ID`：云能力关闭，界面明确未配置
- `MEMBERSHIP_PAYMENT_MODE=disabled`：支付按钮不可用
- `test` / `live`：服务端按模式隔离商品目录；缺商户配置时真实支付失败关闭

## AI 开发

先读 [AGENTS.md](AGENTS.md)。按任务加载 `.agents/skills/`：领域改动用 `mip-membership-domain`，支付用 `wechat-pay`，部署用 `mip-operations`。

## 验收

```bash
pnpm verify
```

真机支付、手机号、订阅消息不能用开发者工具代替。

## 修改品牌

```bash
pnpm project:init --name "新产品名" --namespace mip
```

颜色、Logo、协议入口集中在 `src/config/brand.ts` 与 `src/app.css`。细节见 [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md)。

## 上线

1. `pnpm database:setup -- --confirm-env=<EnvID>`
2. `pnpm cloud:deploy -- --confirm-env=<EnvID>`
3. 配置支付并 `pnpm cloud:deploy-payment`
4. `pnpm admin:bootstrap`
5. 需要演示数据时才 `pnpm seed:demo -- --confirm-demo`
6. 运营后台：小程序内进入 `packages/admin/dashboard`

必须真机完成：手机号授权、真实支付、订阅消息、扫码签到。详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
