# MIP 文档索引

本目录只保留当前产品、架构、状态和验收所需的权威入口。历史计划、阶段性对账和重复矩阵由 Git 历史保存，不再作为当前文档继续维护。

## 权威入口

| 文档 | 唯一职责 | 不包含 |
| --- | --- | --- |
| [REQUIREMENTS.md](REQUIREMENTS.md) | 已确认产品规则、完整范围、可替换配置和待业务确认项 | 实现进度、部署结果、测试数量 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 当前小程序、React Web、CloudBase、数据和安全边界 | 项目排期、运行验收结果 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前仓库与已核实环境状态、剩余缺口 | 长期产品规则、验收方法 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 静态、运行时、云端、真机和生产验收标准及证据索引 | 动态开发进度、临时报告路径 |
| [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md) | 需求域的“实现状态 + 验证状态”双轴矩阵 | 第二套逐项状态表 |
| [FIGMA_MAP.md](FIGMA_MAP.md) | Figma 节点到当前页面、组件和设计合同的映射 | 动态运行状态和临时证据 |

跨目录入口：

- [CONTEXT.md](../../CONTEXT.md)：统一业务语言；
- [DESIGN.md](../../DESIGN.md)：小程序设计规则；
- [admin-web/DESIGN.md](../../admin-web/DESIGN.md)：React Web 设计规则；
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)：仓库级技术入口；
- [docs/KNOWLEDGE_CONTENT.md](../KNOWLEDGE_CONTENT.md)：知识内容的详细领域合同；
- [docs/WECHAT_PAY.md](../WECHAT_PAY.md)：支付详细合同；
- [docs/CLOUDBASE.md](../CLOUDBASE.md)：CloudBase 配置、部署和调度约束。

## 冲突处理

同一事项出现冲突时按以下顺序处理：

1. 身份、金额、资格、权限、状态机和数据安全以 [REQUIREMENTS.md](REQUIREMENTS.md) 及服务端领域合同为准。
2. 当前系统形态、模块边界和调用方向以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。
3. 当前数量、部署状态和已知缺口以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 为准；代码和环境读回优先于文档中的旧数字。
4. 验收层级和证据有效性以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
5. 视觉与交互以 [DESIGN.md](../../DESIGN.md)、[admin-web/DESIGN.md](../../admin-web/DESIGN.md) 和 [FIGMA_MAP.md](FIGMA_MAP.md) 为准，不能推翻服务端业务规则。

需求来源只用于追溯，不直接覆盖上述当前结论。固定快照见 [sources/README.md](sources/README.md)，可提交的验收材料见 [evidence/](evidence/)。来源表里的“未开始”“待评审”和原型演示数据都不是仓库实现状态。

## 文档维护规则

- 产品规则只写入 `REQUIREMENTS.md`；尚未决定且会改变产品模型的事项统一放在该文档末尾“待业务确认”。
- 架构只描述当前结构。未来方案如已被新实现取代，应删除旧描述或另写 ADR，不在当前架构中并列保留。
- 路由数、迁移数、operation 数、环境状态和最近验证日期只写入 `PROJECT_STATUS.md`，并尽量由仓库清单或环境读回生成。
- `ACCEPTANCE.md` 只定义“如何证明”和引用可复核证据；`.tmp/` 会被忽略或覆盖，不得作为权威证据链接。
- `COVERAGE_MATRIX.md` 同时维护实现与验证两个维度。代码存在不能自动把运行时、真机或生产状态标记为通过。
- `sources/` 保存原始来源，`evidence/` 保存可复核证据；二者不承担当期结论，不因当前实现变化而改写历史内容。
- 页面事实必须同时与 `src/app.json`、`config/runtime-pages.json` 和 `FIGMA_MAP.md` 对齐。

## 状态词

实现状态：

- `implemented`：当前代码和本地聚焦测试已形成完整实现证据；
- `partial`：已有主要代码，但仍存在明确行为缺口；
- `missing`：当前没有可触发实现；
- `not-applicable`：经产品决定不进入当前模型。

验证状态：

- `verified-local`：静态检查或本地行为测试已通过；
- `verified-runtime`：已取得对应运行时证据；
- `verified-staging`：已取得当前 staging 环境读回；
- `verified-production`：已取得生产环境证据；
- `external-wait`：仍需正式配置、真机、外部 provider 或生产证据；
- `evidence-missing`：代码可能存在，但当前没有足够可复核证据。

状态可组合，例如 `verified-local + external-wait`。任何验证状态都不能从实现状态自动推导。
