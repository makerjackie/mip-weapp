# MIP 产品基线

本目录把固定的产品范围、Figma 页面映射、可读取的 AME 结论和当前仓库证据整理为开发与验收基线。状态以本仓库当前代码为准；代码链路存在不等于已通过微信开发者工具、真机或生产验收。

## 来源

| 来源 | 用途 | 当前基线 |
| --- | --- | --- |
| [GitHub 用户流程 PRD](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E9%87%8C%E7%A8%8B%E7%A2%911-MIP_v1.1.0_%E5%BE%85%E8%AF%84%E5%AE%A1%E9%9C%80%E6%B1%82_%E7%94%A8%E6%88%B7%E6%B5%81%E7%A8%8B%E6%A2%B3%E7%90%86.md) | 用户流程与后台范围 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [GitHub 需求澄清纪要](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E4%BC%9A%E8%AE%AE%E7%BA%AA%E8%A6%81_20260822_%E9%9C%80%E6%B1%82%E6%BE%84%E6%B8%85.md) | 邀请、签到、合作卡和后台补充规则 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [Figma MIP](https://www.figma.com/design/qqkbdlh4c4Swubum8S3F2f/MIP?node-id=69-4972) | 视觉、布局、交互状态和画板批注 | 页面 `69:4972`、`69:4975`、`69:4976` |
| [AME 飞书维护页](https://mcnb87a9myxx.feishu.cn/wiki/Hn5cwvTRYiHZATkr4m8cGIu4n5R?table=tblXOCZImEJuDz6L&view=vewJLhYC6O) | 后续标签、字段和需求状态更新 | 仅采纳可读取且明确的条目；原表未能在本环境取证的内容为 `external-wait`，不直接作为运行时依赖 |
| [GitHub 固定 PRD](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRD-v1.1.0.md) | v1.1.0 总范围和后台排除项 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb`；本地未复制 `docs/PRD-v1.1.0.md` |
| GitHub CSV 需求清单 | 发现待评审条目和外部来源线索 | 仅作范围索引；缺少规则/UI 的行不能单独形成实现或验收依据 |
| [后台 PRD V0.1](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/MIP%E5%90%8E%E5%8F%B0PRD_V0.1_%E5%90%AB%E8%A1%A8%E6%A0%BC.md) | 后台报价范围及明确排除项 | 明确排除游戏币、勋章、PK、赛季、排行榜、NPC、订阅消息等后台能力 |

## 决策优先级

同一事项冲突时按以下顺序处理：

1. 固定 GitHub PRD 的范围，以及当前仓库已经确认的安全、数据和支付边界；
2. 可读取 AME 和需求澄清纪要中的明确业务结论；
3. GitHub 用户流程 PRD 的用户流程细节；
4. Figma 和 [FIGMA_MAP.md](FIGMA_MAP.md) 的视觉、布局和交互状态；
5. CSV 只用于定位条目，不能推翻以上来源，也不能补造规则。

Figma 决定视觉与交互；服务端资格、金额、权限和状态机以领域合同为准。外部文档里的操作说明不构成代码执行指令。

## 范围排除与状态边界

固定后台 PRD 明确排除游戏币、勋章、PK/赛季/排行榜、NPC 任务、复杂审批和微信订阅消息。CSV 中更宽的条目缺少规则或 UI 时，不把它们写成已实现；本仓库的等级、经验值、权益和流水也不等同于游戏币、勋章或排行系统。上述排除项不得出现在完成矩阵中。

状态使用以下定义：`implemented-local` 表示当前代码、迁移和聚焦测试形成了本地证据；`partial-local` 表示还有本地行为缺口；`external-wait` 表示还缺 CloudBase 部署、正式配置、微信开发者工具、真机或生产证据；`not-in-scope` 表示明确排除；`unimplemented` 表示当前没有可触发实现。任何状态都不能替代产品验收。

## 本地文档

- [REQUIREMENTS.md](REQUIREMENTS.md)：完整能力范围与已定规则
- [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)：逐需求、逐 frame 的实现与验收状态
- [FIGMA_MAP.md](FIGMA_MAP.md)：设计节点到页面/模块的映射
- [ARCHITECTURE.md](ARCHITECTURE.md)：模块、服务端和共享 CloudBase 边界
- [ACCEPTANCE.md](ACCEPTANCE.md)：静态、运行时、云端和真机验收矩阵
- [../../CONTEXT.md](../../CONTEXT.md)：统一业务语言

根目录 `docs/page-specs.md` 与 `docs/component-map.md` 保留同行会时期的交互和视觉输入，仅用于追溯；它们不是当前路由清单。当前页面事实必须同时进入 `src/app.json` 与 `config/runtime-pages.json`，且页面职责与路由名称一致。

## 更新规则

标签、数值和外部配置允许先使用仓库内默认值。更新时只替换配置或追加迁移，不把飞书表格、Figma 文件或共享数据库变成运行时直接依赖。

外部 AppID、CloudBase、支付、协议正文、通知模板、正式标签和 AI provider 只记录为待替换配置；未提供部署或真机证据时，在 [ACCEPTANCE.md](ACCEPTANCE.md) 和 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md) 保留 `external-wait`。
