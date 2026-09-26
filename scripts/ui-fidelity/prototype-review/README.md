# 原型截图验收页

为 43 步 MIP 流程生成一个可离线打开的 HTML：左侧原型，右侧真实运行截图，底部常驻翻页和批注。脚本只处理已采集的截图，不创建模拟运行证据。

```sh
node scripts/ui-fidelity/prototype-review/build-report.mjs \
  --manifest .tmp/review/manifest.json \
  --evidence .tmp/review/evidence.json \
  --feedback .tmp/review/previous-feedback.json \
  --out .tmp/review.html
```

`manifest`、`out` 必填；`evidence`、`feedback` 可省略。参数支持空格或 `=`。截图路径相对于声明它的 JSON 文件解析，因此新 evidence 可以单独引用本轮截图。输出是包含全部图片、样式和脚本的独立 HTML，不读取外部脚本或服务。

- `manifest.steps` 必须包含 43 个唯一 ID，沿用已有角色流程清单结构。
- `evidence.steps[id]` 深合并对应步骤；数组整体替换，添加实际补图时需保留原型补图。
- `additionalImages` 的 `side` 可为 `prototype`、`actual`，分别追加到左右两栏。未指定 side 的操作截图追加到实际侧。
- `actual.chromeOmitted` / `referenceChromeInsetCssPx` 控制中性对齐留白，不伪造系统栏。未指定时，本项目 750×1448 截图补 88px，750×1624 截图不补。
- `review.reviewedImageSha256` 必须绑定被复核主图。图片变化后旧结论自动变成待复核。通过还需要双侧截图、采集时间、真实来源、身份和场景匹配、复核人、时间及结论；证据不足不显示通过。
- 旧用户反馈仅作只读参考，绝不转为 AI 通过，也不预选本轮按钮。当前意见按来源版本、实现版本、截图集合隔离存储；更换图集后重新验收。
- 导出保持原有 `{report, sourceCommit, implementationCommit, exportedAt, feedback}` 格式，每步使用 `{status, note, at}`。浏览器保存失败会提醒，当前内存意见仍可导出。

页面分别展示视觉、交互、角色/数据场景和真机记录。`data-mismatch` / `blocked` 是场景覆盖缺口，不计入“已知问题”；有最新图片复核记录时，仅显示“当前画面已核对”，不升级为目标场景通过。`interactionStatus: failed` 会独立显示，避免视觉通过掩盖交互问题。汇总分类允许重叠，AI 可自行完成的核对仍标为 AI 待补测。

原有证据结构继续有效，可追加以下字段明确验证范围：

- `actual.interactionEvidence: string[]` 或 `review.interactionNotes: string`：真实操作及结果；`interactionStatus: pass` 还需要这些记录，只有部分记录且状态仍是 `pending` 时显示“部分已测”。
- `review.deviceRequired: boolean`：是否列有专项真机要求。旧数据普遍只有 `deviceStatus: pending`，未明确范围时显示“范围未单列”，不把所有页面自动变成用户真机任务。
- `review.deviceNotes: string | string[]`：具体真机待测项目或已验证记录。仅当视觉/交互均有当前证据、场景一致，且唯一剩余项为明确列出的真机测试时，显示“仅真机待测”。

这些展示字段不会回写输入 JSON，也不会改变用户批注；截图 SHA 变化会让旧视觉、交互和真机通过记录失效。详述记录保留在折叠区域，主界面仍以左右截图、翻页和批注为主。

截图、用户反馈、生成的报告与本机路径只保留在 `.tmp/` 等本地目录，不提交进仓库。可提交的验收摘要遵循 [验收标准](../../../docs/mip/ACCEPTANCE.md)，不能用此网页的静态截图核对替代真机、授权、支付或部署证据。

实现分别位于 `build-report.mjs`（校验和生成）、`template.html`（结构）、`review.css`（布局）、`review.js`（翻页和意见）。聚焦验证：

```sh
pnpm exec vitest run tests/mip-prototype-review.test.ts
pnpm exec eslint scripts/ui-fidelity/prototype-review tests/mip-prototype-review.test.ts
```
