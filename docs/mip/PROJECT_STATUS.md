# MIP 当前状态

更新日期：2026-08-31。

本文是路由数、迁移数、operation 数、部署状态和当前缺口的唯一文档入口。产品规则见 [REQUIREMENTS.md](REQUIREMENTS.md)，验证口径见 [ACCEPTANCE.md](ACCEPTANCE.md)，逐域状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。

## 结论

当前产品形态为“小程序用户端 + 小程序管理分包 + 独立 React Web 管理端”。会员、活动、机会、成长、任务、游戏、内容、消息、订单、支付和运营管理已经形成统一的服务端事实与本地实现底座，不需要整体重写。

仓库清单当前为 110 条小程序路由、58 个锁定迁移、187 个渠道中立管理 operation（80 查询、107 写）和 16 个数据库核心函数。Web 使用其中 80 个查询与 80 个受审 mutation。以上数字只描述当前代码合同，不自动证明运行时、云端或生产通过。

## 仓库事实

| 范围 | 当前事实 | 权威来源 |
| --- | --- | --- |
| 小程序路由 | 110 条：5 条主包、56 条用户分包、49 条管理分包 | `config/runtime-pages.json`、`src/app.json` |
| 数据库 | 58 个追加迁移；目标 runtime 表清单为 124 张 | `database/mysql/mip/migrations.lock.json`、迁移生成清单 |
| 管理合同 | 187 个 operation：80 查询、107 写 | `cloudfunctions/mip-admin-api/domain/public-operation-contract.js` |
| Web 开放范围 | 80 查询、80 个受审 mutation | `cloudfunctions/mip-admin-api/lib/web-bff-auth.js` |
| 云函数 | 23 个 `mip-*` 函数目录；数据库核心部署清单为 16 个函数 | `cloudfunctions/`、部署清单 |
| 调度 | 消息和知识采集各有独立 scheduler；均不属于数据库核心函数 | `mip-message-scheduler`、`mip-knowledge-scheduler` 及部署脚本 |
| Web 页面 | 14 个一级页面、8 类详情 | `admin-web/src/` 的路由与页面合同 |
| 管理端形态 | 小程序管理分包与 React Web 同时存在，共享管理 operation 和服务端事实 | `src/packages/admin/`、`admin-web/`、`packages/admin-contracts/` |

## 环境状态

| 环境 | 当前已核实状态 | 不能外推 |
| --- | --- | --- |
| MIP staging | 58 个迁移已应用，124 张 runtime 表完成隔离和最小权限读回；核心函数读回通过 | 不代表正式生产环境、正式 AppID 或真实支付通过 |
| React Web 生产 | `https://mipmini.01mvp.com/` 已有 14/14 一级页面登录态读取证据；Banner JPEG 上传后以 `INACTIVE` 保存并软删除；无手机号、零行用户导出完成文件完整性与一次性消费验证 | 不代表全部 mutation、全部媒体用途、非空/含手机号导出、支付或外部消息通过 |
| 小程序运行时 | 路由与代表旅程有过本地开发者工具执行记录，但原报告位于被 Git 忽略的 `.tmp/`，不作为仓库权威证据 | 不能据此声明当前 checkout、真机或 Mac/Windows 微信客户端通过 |
| 正式小程序 | 正式 AppID、商户、回调、通知、AI/provider 和真机能力仍待验收 | 不能用 staging、浏览器或开发者工具结果代替 |

## 已形成稳定底座

- 用户、玩家/嘉宾、城市分会、会员权益、订单、活动、机会、成长、任务、游戏化、知识内容和消息使用服务端事实模型。
- 玩家资格、金额、报名、签到、成长余额和管理权限不由客户端计算。
- 平台、城市分会和活动三级 scope，以及七类管理角色，已有 capability、事务内重授权和审计实现。
- `mip_*` 表、`mip/` 对象路径、函数名和部署清单与共享环境中的其他项目隔离。
- 支付 ledger、退款、outbox、站内消息和媒体安全已有代码及聚焦测试。
- 管理端使用渠道中立 DTO、错误合同、trusted principal、transport 和 operation registry。
- React Web 已迁入 `admin-web/`，独立构建、独立部署，并与小程序管理端共享服务端合同。
- 消息排期和知识采集分别使用不连接 MySQL 的滚动单次 scheduler；worker 不安装高频定时器。

## 当前缺口

### 证据与运行环境

- 当前 checkout 缺少可提交的 110 路由完整运行报告；下一次完整运行验收应把摘要、环境、提交号和必要截图整理到 `docs/mip/evidence/`，不再只引用 `.tmp/`。
- 管理端仍需 Mac 和 Windows 微信客户端的发布版本验收。
- Figma 代表 frame 已固定，但仍需与当前实现做同尺寸、逐屏差异验收。
- staging 的 58/124 读回需要在后续环境变更时重新生成，不得继续沿用旧日期结论。

### 真机与正式配置

- 手机号授权与换绑、扫码签到、相册、地图、日历、录音、私密视频号和 `web-view` 需要真机。
- 正式 AppID、微信支付商户、支付/退款回调、通知模板和 AI/provider 尚未完成生产验收。
- 正式协议、城市/行业目录、等级规则、勋章、游戏规则、知识内容和价格仍是可替换配置。
- 消息和知识 scheduler 代码已完成；专用 CAM 角色、canary、激活和最终云端读回仍按各自环境证据判断，不用代码存在代替部署结论。

## 证据入口

- [当前 React Web 线上验收](evidence/admin-web-live-2026-08-28-react/README.md)
- [早期 React Web 线上证据](evidence/admin-web-live-2026-08-28/README.md)（只作历史追溯）
- [管理端响应式密度验收](evidence/admin-density-2026-08-26/README.md)
- [Figma 固定证据](evidence/figma-2026-08-25/README.md)

证据的适用层级和外推限制以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
