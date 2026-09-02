# MIP 产品仓库

MIP 的会员、活动、合作与运营产品仓库。根目录是原生微信小程序，`admin-web/` 是独立构建和部署的 React 管理后台；两端复用 CloudBase 服务端、MySQL 追加迁移和平台中立的管理契约。

## 工程组成

- `src/`：微信小程序页面、领域模块、平台适配与配置
- `admin-web/`：React 管理后台
- `packages/admin-contracts/`：两端共用的 `AdminRequest v1` 中立契约
- `cloudfunctions/`：`mip-*` 云函数
- `database/mysql/mip/`：追加迁移、结构校验和演示数据
- `docs/`：架构、领域、部署和验收文档

## 开始使用

```bash
git clone git@github.com:makerjackie/mip-weapp.git
cd mip-weapp
pnpm install
pnpm setup
pnpm dev:open
```

仓库默认使用 `touristappid`。没有 CloudBase 和支付配置时可以打开基础界面，但受保护能力会明确显示未配置或不可用，不模拟登录、支付或权益成功。

## 本地配置

1. 复制并填写 `.env.local`，真实 AppID、EnvID、商户号和密钥只保存在本机。
2. 使用 `src/config/brand.ts` 配置品牌，或运行 `pnpm project:init --name "产品名"`。
3. 运行 `pnpm setup:local` 生成本机项目配置。
4. CloudBase、数据库和支付配置分别遵循 [CloudBase](docs/CLOUDBASE.md)、[部署](docs/DEPLOYMENT.md) 和 [微信支付](docs/WECHAT_PAY.md) 文档。

## 常用命令

```bash
pnpm dev:open
pnpm verify
pnpm admin:web:dev
pnpm admin:web:verify
pnpm verify:all
```

`pnpm verify` 验证小程序和服务端源码，`pnpm admin:web:verify` 独立验证 Web，`pnpm verify:all` 顺序执行两端门禁。支付、手机号、订阅消息和扫码签到仍需真机或目标环境证据。

## 文档

从 [文档入口](docs/README.md) 查找当前权威文档。协作规则见 [AGENTS.md](AGENTS.md)，业务语言见 [CONTEXT.md](CONTEXT.md)，界面规则见 [DESIGN.md](DESIGN.md)。当前实现范围、部署状态和未完成验收只在 [MIP 项目状态](docs/mip/PROJECT_STATUS.md) 维护。

## 关键边界

- 页面只提交意图；会员、金额、库存、报名、签到、成长、排行和权限由服务端决定。
- `requestPayment` 成功不代表订单、报名或会员权益已经生效。
- 新数据只写 `mip_*` 表，对象存储只写 `mip/` 前缀。
- React Web 是唯一完整运营后台；小程序只保留现场工作台。两端复用同一服务端业务合同，不复制状态机和权限规则。
- 仓库中的迁移和函数源码不等于目标环境已经部署；环境结论必须有对应验收记录。
