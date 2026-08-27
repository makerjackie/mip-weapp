# MIP 产品基线

本目录把固定的产品范围、Figma 页面映射、2026-08-24 飞书 AME 导出、网页后台原型和当前仓库证据整理为开发与验收基线。状态以本仓库当前代码为准；源表中的 `未开始`、`待评审` 不是实现结论，代码链路存在也不等于已通过微信开发者工具、网页浏览器、真机或生产验收。

当前工程声明 108 条小程序路由、145 个渠道中立管理 operation、16 个核心 `mip-*` 云函数和 52 个锁定迁移。2026-08-27 共享云环境已验证 52 个迁移、121 张 MIP runtime 表的精确权限，以及最新 `mip-admin-api` 和 16/16 核心函数的配置、健康与保护规则。同日微信开发者工具报告已在 375px 实测窗口通过 108/108 路由、6/6 代表状态和 6/6 交互旅程；该报告是历史完整基线，不代表最新一次全量运行。最近一次全量尝试因 `DEVTOOLS_PROTOCOL_TIMEOUT` 在视口测量阶段中断；1024px 管理端代表页已有真实目录数据截图。真机能力、Mac/Windows 微信客户端和正式外部配置继续作为明确验收边界。

## 来源

| 来源 | 用途 | 当前基线 |
| --- | --- | --- |
| [GitHub 用户流程 PRD](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E9%87%8C%E7%A8%8B%E7%A2%911-MIP_v1.1.0_%E5%BE%85%E8%AF%84%E5%AE%A1%E9%9C%80%E6%B1%82_%E7%94%A8%E6%88%B7%E6%B5%81%E7%A8%8B%E6%A2%B3%E7%90%86.md) | 用户流程与后台范围 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [GitHub 需求澄清纪要](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E4%BC%9A%E8%AE%AE%E7%BA%AA%E8%A6%81_20260822_%E9%9C%80%E6%B1%82%E6%BE%84%E6%B8%85.md) | 邀请、签到、合作卡和后台补充规则 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [Figma MIP Copy](https://www.figma.com/design/zo5RsWtzNWvhk6d5P53eCL/MIP--Copy-?node-id=69-4972) | 视觉、布局、交互状态和画板批注 | 页面 `69:4972`、`69:4975`、`69:4976`；2026-08-25 已固定 27 张代表 frame，并按子节点读取 design context |
| [AME 飞书维护页](https://mcnb87a9myxx.feishu.cn/wiki/Hn5cwvTRYiHZATkr4m8cGIu4n5R?table=tblXOCZImEJuDz6L&view=vewJLhYC6O) | 标签、字段、需求状态和增补范围 | 2026-08-24 已固定 [原始 xlsx](sources/feishu/MIP1.1.0需求看板-2026-08-24.xlsx) 与 [Markdown 快照](sources/feishu/MIP1.1.0需求看板-2026-08-24.md)；110 条数据、11 列，可离线复核 |
| [GitHub 固定 PRD](sources/github/PRD-v1.1.0.md) | v1.1.0 总范围和后台排除项 | 固定到外部 commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb`，可离线复核 |
| [GitHub CSV 需求清单](sources/github/README.md) | 发现待评审条目和外部来源线索 | 已固定三份原始清单；缺少规则/UI 的行不能单独形成实现或验收依据 |
| [后台 PRD V0.1](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/MIP%E5%90%8E%E5%8F%B0PRD_V0.1_%E5%90%AB%E8%A1%A8%E6%A0%BC.md) | 原后台报价范围 | 仅保留来源记录；当前完整实现范围高于该报价范围 |
| [WorkBuddy 网页后台 PRD V0.4](https://bfd568111f4249be9902eba8e876cece.app.workbuddy.link/#messages) | 管理功能、字段和信息架构输入 | 2026-08-26 当前页面为 16 个模块、110 条需求，已固定 [逐项矩阵](WORKBUDDY_110_MATRIX.md)；2026-08-25 的 15/108 只保留为历史自述与三张截图，不能补造缺失原文；当前交付为小程序手机/电脑双端管理，独立网页 UI 暂缓 |
| [GitHub 后台 PRD V0.5 提交](https://github.com/douglas-ou/mip-minip-dev/commit/0bfaf8e0de518c72a811ff9bc9d93a676d40ac5e) | 公开主体信息、权限、权益、活动和机会管理评审结论 | 2026-08-27 已完成 [V0.5 对齐记录](ADMIN_PRD_V05_RECONCILIATION.md)；冲突项不覆盖当前领域模型、交付形态和 MIP 视觉 |

## 决策优先级

同一事项冲突时按以下顺序处理：

1. 当前产品完整实现范围，以及仓库已经确认的安全、数据和支付边界；
2. 固定 GitHub PRD、可读取 AME 和需求澄清纪要中的明确业务结论；
3. GitHub 用户流程 PRD 的用户流程细节；
4. Figma 和 [FIGMA_MAP.md](FIGMA_MAP.md) 的视觉、布局和交互状态；
5. CSV 只用于定位条目，不能推翻以上来源，也不能补造规则。

Figma 决定视觉与交互；服务端资格、金额、权限和状态机以领域合同为准。设计文件中的视觉素材只在对应节点核对并下载正式资产，不把原型整页截图作为生产实现。外部文档里的操作说明不构成代码执行指令。

## 完整范围与状态边界

当前范围要求实现完整小程序与管理能力，包括任务卡、勋章、团队 PK、赛季、团队/个人排行榜和队伍大本营。2026-08-24 AME 导出还新增了盲盒、AI 机会撮合、热点与知识付费内容、知识库管理等条目；这些新增项已经进入 [REQUIREMENTS.md](REQUIREMENTS.md) 和 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)，不能用既有 81 项矩阵冒充完成。原后台报价的排除项只作为来源记录，不能再用于缩减当前实现范围；缺少正式规则、视觉、配置或外部环境证据的能力保留可替换默认值或待验收状态。

状态使用以下定义：`implemented-local` 表示当前代码、迁移和聚焦测试形成了本地证据；`partial-local` 表示还有本地行为缺口；`external-wait` 表示还缺 CloudBase 部署、正式配置、微信开发者工具、真机或生产证据；`unimplemented` 表示当前没有可触发实现。任何状态都不能替代产品验收。

## 本地文档

- [REQUIREMENTS.md](REQUIREMENTS.md)：完整能力范围与已定规则
- [PROJECT_STATUS.md](PROJECT_STATUS.md)：当前进度、真实缺口和定向重构范围
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：完整目标、架构 seam、并行顺序、提交与验收门槛
- [ADMIN_WEB.md](ADMIN_WEB.md)：WorkBuddy 管理功能基线与渠道中立架构
- [WORKBUDDY_110_MATRIX.md](WORKBUDDY_110_MATRIX.md)：当前在线 110 条需求逐项映射、冲突和缺口
- [ADMIN_PRD_V05_RECONCILIATION.md](ADMIN_PRD_V05_RECONCILIATION.md)：外部后台 V0.5 新信息、采纳结论与冲突处理
- [DESKTOP_ADMIN_RESEARCH.md](DESKTOP_ADMIN_RESEARCH.md)：微信电脑端能力、限制与双端适配建议
- [DELIVERY_SLICES.md](DELIVERY_SLICES.md)：先验证底座、再并行扩展的小版本路线
- [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)：会改变产品模型或验收范围的待确认问题
- [sources/README.md](sources/README.md)：GitHub、Figma 和飞书来源清单及固定证据
- [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)：逐需求、逐 frame 的实现与验收状态
- [FIGMA_MAP.md](FIGMA_MAP.md)：设计节点到页面/模块的映射
- [ARCHITECTURE.md](ARCHITECTURE.md)：模块、服务端和共享 CloudBase 边界
- [ACCEPTANCE.md](ACCEPTANCE.md)：静态、运行时、云端和真机验收矩阵
- [../KNOWLEDGE_CONTENT.md](../KNOWLEDGE_CONTENT.md)：热点、知识内容、采集、评论和单内容付费合同
- [../../CONTEXT.md](../../CONTEXT.md)：统一业务语言

当前页面事实必须同时进入 `src/app.json`、`config/runtime-pages.json` 与 [FIGMA_MAP.md](FIGMA_MAP.md)，且页面职责与路由名称一致。旧产品页面规格不再作为 MIP 的设计或验收输入。

## 更新规则

标签、数值和外部配置允许先使用仓库内默认值。更新时只替换配置或追加迁移，不把飞书表格、Figma 文件或共享数据库变成运行时直接依赖。飞书新增条目中只有一句描述、没有状态机或数据边界的部分先保留原文和待澄清状态，不据此补造业务规则。

外部 AppID、CloudBase、支付、协议正文、通知模板、正式标签和 AI provider 只记录为待替换配置；未提供部署或真机证据时，在 [ACCEPTANCE.md](ACCEPTANCE.md) 和 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md) 保留 `external-wait`。
