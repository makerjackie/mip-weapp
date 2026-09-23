# MIP 当前状态

更新日期：2026-09-23（仓库清单；环境证据仍保留各自采集日期）。

本文是路由数、迁移数、operation 数、部署状态和当前缺口的唯一文档入口。产品规则见 [REQUIREMENTS.md](REQUIREMENTS.md)，验证口径见 [ACCEPTANCE.md](ACCEPTANCE.md)，逐域状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。

## 结论

当前产品形态为“小程序用户端 + 五路由小程序现场工作台 + React Web 主后台”。会员、活动、机会、成长、任务、游戏、内容、消息、订单、支付和运营管理已经形成统一的服务端事实与本地实现底座，不需要整体重写。

仓库清单当前为 70 条小程序路由、92 个锁定迁移、237 个渠道中立管理 operation（103 查询、134 写）和 16 个数据库核心函数。Web 合同允许其中 103 个查询与 134 个受审 mutation。以上数字只描述当前代码合同，不自动证明每个 action 均有真实实现，更不证明运行时、云端或生产通过；名片管理和旧角色创建等缺口见下文。

## 仓库事实

| 范围 | 当前事实 | 权威来源 |
| --- | --- | --- |
| 小程序路由 | 70 条：5 条主包、60 条用户分包、5 条管理分包（含网页登录确认页） | `config/runtime-pages.json`、`src/app.json` |
| 数据库 | 92 个追加迁移；目标清单为 146 张 runtime 表 | `database/mysql/mip/migrations.lock.json`、迁移生成清单 |
| 管理合同 | 237 个 operation：103 查询、134 写 | `cloudfunctions/mip-admin-api/domain/public-operation-contract.js` |
| Web 开放范围 | 103 查询、134 个受审 mutation | `cloudfunctions/mip-admin-api/domain/public-operation-contract.js` |
| 云函数 | 23 个 `mip-*` 函数目录；数据库核心部署清单为 16 个函数 | `cloudfunctions/`、部署清单 |
| 调度 | 消息和知识采集各有独立 scheduler；均不属于数据库核心函数 | `mip-message-scheduler`、`mip-knowledge-scheduler` 及部署脚本 |
| Web 页面 | 14 个一级页面、13 类详情 | `admin-web/src/` 的路由与页面合同 |
| 管理端形态 | React Web 是唯一完整后台；小程序现场工作台只保留 Web 登录确认、已授权活动、签到码与海报、名单与签到，共享管理 operation 和服务端事实 | `src/packages/admin/`、`admin-web/`、`packages/admin-contracts/` |

## 环境状态

| 环境 | 当前已核实状态 | 不能外推 |
| --- | --- | --- |
| MIP staging | 2026-09-23 TEST staging 回读 92/92 个迁移、146 张表精确运行权限；16 个核心函数重新部署并通过完整 `cloud:verify`（含支付函数健康）；见[本轮部署证据](evidence/latest-requirements-2026-09-23/STAGING.md) | 不代表小程序页面、真机支付或正式生产环境通过 |
| React Web 生产 | 2026-09-23 已发布最新 Pages 构建，正式域名资源指纹匹配，未登录管理接口返回 `401 AUTH_REQUIRED`；此前 14/14 一级页面登录态读取、Banner 与零行导出证据属于旧版验收 | 最新部署尚无登录后读写验收，不代表全部 mutation、非空导出、支付或外部消息通过 |
| 小程序开发版 | `0.2.0.20260923.2` 在完整 `pnpm verify:all` 后通过登录的开发者工具上传，CLI 返回 `✔ upload`；视觉修正代码为 `df7532d5` | 尚未切换体验版、提审或正式发布 |
| 小程序运行时 | 部署前一次 Node 22 尝试有 69/70 路由进入接受态；此前三次自动截图失败且重连超时。本轮开发者工具人工复核等级页与“相关机会”原位切换，并更新并排 HTML 中这两步的实拍，详见[本地验收证据](evidence/latest-requirements-2026-09-23/README.md) | 不构成 70/70 路由、43 步逐帧同条件比较、完整交互或真机验收 |
| 正式小程序 | 正式 AppID、商户、回调、通知、AI/provider 和真机能力仍待验收 | 不能用 staging、浏览器或开发者工具结果代替 |

## 已形成稳定底座

- 用户、玩家/嘉宾、城市分会、会员权益、订单、活动、机会、成长、任务、游戏化、知识内容和消息使用服务端事实模型。
- 玩家资格、金额、报名、签到、成长余额和管理权限不由客户端计算。
- 平台、城市分会和活动三级 scope，以及七类管理角色，已有 capability、事务内重授权和审计实现。
- `mip_*` 表、`mip/` 对象路径、函数名和部署清单与共享环境中的其他项目隔离。
- 支付 ledger、退款、outbox、站内消息和媒体安全已有代码及聚焦测试。
- 管理端使用渠道中立 DTO、错误合同、trusted principal、transport 和 operation registry。
- React Web 已迁入 `admin-web/`，独立构建、独立部署，并与小程序现场工作台共享服务端合同。
- 消息排期和知识采集分别使用不连接 MySQL 的滚动单次 scheduler；worker 不安装高频定时器。

## 当前缺口

### 证据与运行环境

- 已保存部署前运行时摘要与无个人信息的状态截图；部署后自动截图接口与重连失败，仍缺少 70/70 路由及全部严格交互通过的报告。本地 `.tmp/` 报告不可替代真机证据。
- 小程序现场工作台仍需真实设备完成 Web 登录确认、签到码、扫码、海报保存、手工签到和受控撤销验收；React Web 继续按浏览器桌面和手机视口验收。
- 最新流程画布与需求仓库 `role-flows` 是本轮界面依据；旧原型已从需求仓库删除。部署前的 70 路由运行尝试有 1 条受限页和严格交互未通过；部署后截图接口失败，差异记录见 [需求与实现差异](REQUIREMENTS_DIFF_20260922.md)。
- 43 步原型已做[逐步对照](PROTOTYPE_PARITY_20260923.md)；J6-02 的案例时间轴已补到正式页，J6-03 在档案内切换带数量的机会子列表仍与原型不同。有内容的案例时间轴和 43 步逐帧截图仍待真实数据及稳定的开发者工具截图接口验证。
- J3-09 “我想合作”只有按钮与占位提示；原型没有定义合作意向的服务端状态、撤销、通知和列表口径。不能把现有“指定对象引荐”或“对档案感兴趣”冒充该流程。
- “我的任务”的待完成/已结束页签目前只过滤已加载的分页结果。首批 20 条没有所选状态但还有后续页时，页面会提示继续加载，避免误报全部任务为空；完整分类分页仍需服务端按状态过滤并保持游标语义。
- 通用名片管理 `mip.admin.cards.*` 仍是占位：小程序名片来自用户档案，旧 `mip_business_cards` 表缺少 AppID 和所有者，不能把管理端空列表视为已完成。`mip.admin.roles.create` 是 Web 未开放的旧占位；固定七类管理角色通过 `roles.set` 与权限模板管理。详见 [差异记录](REQUIREMENTS_DIFF_20260922.md)。
- staging 的本轮数据库和函数读回见[部署证据](evidence/latest-requirements-2026-09-23/STAGING.md)；后续环境变更时必须重新生成，小程序仍需独立运行时和真机验收。

### 真机与正式配置

- 手机号授权与换绑、扫码签到、相册、地图、日历、录音、私密视频号和 `web-view` 需要真机。
- 正式 AppID、微信支付商户、支付/退款回调、通知模板和 AI/provider 尚未完成生产验收。
- 正式协议、城市/行业目录、等级规则、勋章、游戏规则、知识内容和价格仍是可替换配置。
- 消息和知识 scheduler 代码已完成；专用 CAM 角色、canary、激活和最终云端读回仍按各自环境证据判断，不用代码存在代替部署结论。

## 证据入口

- [2026-09-23 最新需求本地验收](evidence/latest-requirements-2026-09-23/README.md)（静态门禁通过；小程序运行时和外部能力尚未全过）

- [2026-09-14 消息分页与已读修复发布](evidence/2026-09-14-inbox-release.md)（消息函数已更新，小程序实际调用验证未读数为 0，开发版本已上传；全量云端管理验收仍受 CAM 鉴权阻塞）

- [2026-09-15 访客已读与感兴趣交互修复](evidence/2026-09-15-visitors-interest-fix.md)（机会服务已更新并通过健康回读；真机复测待完成）
- [2026-09-14 微信支付修复与验收](evidence/2026-09-14-wechat-pay-fix.md)（CloudPay 查单、通知和内部签名已修复并部署；用户确认会员支付正常，活动支付及退款闭环仍待验收）
- [当前 React Web 线上验收](evidence/admin-web-live-2026-08-28-react/README.md)
- [早期 React Web 线上证据](evidence/admin-web-live-2026-08-28/README.md)（只作历史追溯）
- [旧小程序完整管理端响应式密度验收](evidence/admin-density-2026-08-26/README.md)（只作历史追溯，不证明当前现场工作台）
- [历史设计固定证据](evidence/figma-2026-08-25/README.md)（只作历史追溯，不作为本轮设计依据）

证据的适用层级和外推限制以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
