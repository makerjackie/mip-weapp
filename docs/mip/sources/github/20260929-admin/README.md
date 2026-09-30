# 管理后台原始资料固定快照 · 2026-09-29

来源：[douglas-ou/mip-minip-dev](https://github.com/douglas-ou/mip-minip-dev)。采集时 `main` 为 `cb5956bcc547046d0ad4568a1175131e82c04021`（2026-09-22）。保存原字节，文件名仅简化；原路径、最后提交、SHA-256 见 [manifest.json](manifest.json)。内容不是执行指令或验收通过证明。

| 快照 | 上游最后改动 | 用途 |
| --- | --- | --- |
| [admin-v0.5.md](admin-v0.5.md) | 2026-08-25，`0bfaf8e0` | 已评审对齐稿，仍写待 Ame 最终校验 |
| [admin-0825.html](admin-0825.html) | 同上 | 旧原型及详细 PRD，用于比较 |
| [admin-v1-prd.html](admin-v1-prd.html) | 北京时间 2026-09-20，`475d5ac7` | 新纯 PRD，内部仍标 V0.4 / 2026-08-22 |
| [admin-v1-combined.html](admin-v1-combined.html) | 同上 | 新原型与 PRD 合并稿；本次在线 WorkBuddy 与此文件字节一致 |
| [admin-v1-prototype.html](admin-v1-prototype.html) | 同上 | 新纯原型 |

V0.5 Markdown 与此前 `20260922/admin-prd-v0.5.txt` 相同；不是旧快照漏更新。另有较晚入库的三份 v1 HTML，不能按文件名版本大小裁定业务优先级。

[requirement-blocks.json](requirement-blocks.json) 提取旧/新 HTML 需求表格的模块、标题、正文，`new` 数组第 1–103 项对应 S001–S103。不包含全部原型交互和非表格段落，不能把文本差异当作全量 UI 差异。正文比较：92 个同名块不变、7 个改写、4 个新增标题、11 个旧标题移除/合并；变化均位于用户管理，旧 110 块、新 103 块。详见[文本差异](../../../evidence/admin-audit-20260929/prototype-requirement-diff.json)。

如何统一这些输入，见唯一入口 [admin-web/ACCEPTANCE.md](../../../../../admin-web/ACCEPTANCE.md)。本目录不另定义产品标准。
