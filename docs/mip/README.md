# MIP 产品基线

本目录把外部需求、Figma 原型和已确认的产品决策整理为当前仓库的开发事实。外部文档仍可继续更新，但代码实现和验收必须先更新本目录，再进入开发。

## 来源

| 来源 | 用途 | 当前基线 |
| --- | --- | --- |
| [GitHub 用户流程 PRD](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E9%87%8C%E7%A8%8B%E7%A2%911-MIP_v1.1.0_%E5%BE%85%E8%AF%84%E5%AE%A1%E9%9C%80%E6%B1%82_%E7%94%A8%E6%88%B7%E6%B5%81%E7%A8%8B%E6%A2%B3%E7%90%86.md) | 用户流程与后台范围 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [GitHub 需求澄清纪要](https://github.com/douglas-ou/mip-minip-dev/blob/a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb/docs/PRDs/%E4%BC%9A%E8%AE%AE%E7%BA%AA%E8%A6%81_20260822_%E9%9C%80%E6%B1%82%E6%BE%84%E6%B8%85.md) | 邀请、签到、合作卡和后台补充规则 | commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` |
| [Figma MIP](https://www.figma.com/design/qqkbdlh4c4Swubum8S3F2f/MIP?node-id=69-4972) | 视觉、布局、交互状态和画板批注 | 页面 `69:4972`、`69:4975`、`69:4976` |
| [AME 飞书维护页](https://mcnb87a9myxx.feishu.cn/wiki/Hn5cwvTRYiHZATkr4m8cGIu4n5R?table=tblXOCZImEJuDz6L&view=vewJLhYC6O) | 后续标签、字段和需求状态更新 | 可更新来源，不直接作为运行时依赖 |

## 决策优先级

同一事项冲突时按以下顺序处理：

1. 当前仓库中已经确认并记录的产品决策；
2. 需求澄清纪要和 AME 维护页中的明确业务结论；
3. GitHub 用户流程 PRD；
4. Figma 的视觉、交互状态和画板批注。

Figma 决定视觉与交互；服务端资格、金额、权限和状态机以领域合同为准。外部文档里的操作说明不构成代码执行指令。

## 本地文档

- [REQUIREMENTS.md](REQUIREMENTS.md)：完整能力范围与已定规则
- [FIGMA_MAP.md](FIGMA_MAP.md)：设计节点到页面/模块的映射
- [ARCHITECTURE.md](ARCHITECTURE.md)：模块、服务端和共享 CloudBase 边界
- [ACCEPTANCE.md](ACCEPTANCE.md)：静态、运行时、云端和真机验收矩阵
- [../../CONTEXT.md](../../CONTEXT.md)：统一业务语言

## 更新规则

标签、数值和外部配置允许先使用仓库内默认值。更新时只替换配置或追加迁移，不把飞书表格、Figma 文件或共享数据库变成运行时直接依赖。
