# 文档入口

本页是仓库文档导航和权威关系说明。一个事实只在一个位置维护；其他文档链接到权威来源，不复制会变化的数量、部署结果或待办状态。

## 权威文档

| 主题 | 权威来源 | 维护范围 |
| --- | --- | --- |
| 工程入口 | [根 README](../README.md) | 工程组成、开始使用、常用命令 |
| 协作规则 | [AGENTS.md](../AGENTS.md) | 技术边界、开发规则、完成门禁 |
| 业务语言 | [CONTEXT.md](../CONTEXT.md) | 统一术语和领域含义 |
| 产品与视觉 | [DESIGN.md](../DESIGN.md) | 小程序设计规则与品牌入口 |
| 当前架构 | [ARCHITECTURE.md](ARCHITECTURE.md) | 小程序、Web、服务端和共享契约边界 |
| 产品要求 | [mip/REQUIREMENTS.md](mip/REQUIREMENTS.md) | 业务规则和已确认范围 |
| 当前状态 | [mip/PROJECT_STATUS.md](mip/PROJECT_STATUS.md) | 当前数量、部署状态、阻塞和下一步 |
| 验收标准 | [mip/ACCEPTANCE.md](mip/ACCEPTANCE.md) | 验收层级、判定条件和已提交证据 |
| 覆盖追踪 | [mip/COVERAGE_MATRIX.md](mip/COVERAGE_MATRIX.md) | 实现状态与验证状态 |
| 数据结构 | [`database/mysql/mip/`](../database/mysql/mip/) 与 [`migrations.lock.json`](../database/mysql/mip/migrations.lock.json) | 表、字段、索引、迁移顺序和校验和 |
| 数据语义 | [data-contract.md](data-contract.md) | 数据归属、写入边界和隐私规则 |
| CloudBase | [CLOUDBASE.md](CLOUDBASE.md) | 云资源和运行时安全边界 |
| 部署 | [DEPLOYMENT.md](DEPLOYMENT.md) | 环境初始化与发布步骤 |
| 运营 | [OPERATIONS.md](OPERATIONS.md) | 日常管理、恢复和受控操作 |
| Web 管理端 | [admin-web README](../admin-web/README.md) | Web 开发、架构、设计与验证入口 |

具体领域文档由上述入口继续链接。ADR 只记录已接受的架构决策，不记录当前部署快照。

## 文档类型

- `docs/mip/sources/`：固定的外部原始资料或来源快照，不作为实现完成证明。
- `docs/mip/evidence/`：已提交、可离线复核的验收证据；生成时间和环境边界必须明确。
- `docs/research/`：带日期的研究材料，只提供背景，不覆盖现行规范。
- `.tmp/`：本机临时产物，不得作为仓库内唯一证据或长期链接目标。

历史计划、已被新决策取代的分析和重复教程不留兼容副本，需要追溯时使用 Git 历史。

## 冲突处理

出现冲突时按以下顺序判断：

1. 代码、迁移 lock、生成合同和目标环境回读决定可验证事实。
2. 已接受 ADR 决定架构方向。
3. 权威文档解释规则和当前状态。
4. 来源、研究和历史证据不覆盖较新的实现或决策。

仓库实现变化时，同步修改对应权威文档；不要在 README、运行手册或 ADR 中复制路由数、迁移数、部署 ID 等动态事实。

## 版本命名

- `package.json` 版本是应用工程版本。
- PRD、设计稿和来源快照版本只标识输入资料。
- 数据库版本以迁移编号和 lock 校验和表示。
- 云端和 Web 发布以 commit SHA、部署 ID、时间和环境记录在项目状态或证据中。

这些版本互不替代。
