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

截图、用户反馈、生成的报告与本机路径只保留在 `.tmp/` 等本地目录，不提交进仓库。可提交的验收摘要遵循 [验收标准](../../../docs/mip/ACCEPTANCE.md)，不能用此网页的静态截图核对替代真机、授权、支付或部署证据。

实现分别位于 `build-report.mjs`（校验和生成）、`template.html`（结构）、`review.css`（布局）、`review.js`（翻页和意见）。聚焦验证：

```sh
pnpm exec vitest run tests/mip-prototype-review.test.ts
pnpm exec eslint scripts/ui-fidelity/prototype-review tests/mip-prototype-review.test.ts
```
