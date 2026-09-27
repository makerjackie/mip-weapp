# 临时共享验收站

复用原型对照页，生成可以部署到静态托管的目录。每位验收者的意见只保存在自己的浏览器，不自动回传；通过“导出全部意见”交付 JSON。

```sh
node scripts/ui-fidelity/prototype-review/build-public-site.mjs \
  --manifest .tmp/settings-move-20260926/manifest.json \
  --evidence .tmp/settings-move-20260926/evidence.json \
  --publication .tmp/publication.json \
  --results .tmp/test-results.json \
  --out .tmp/miptest-site
```

输出目录必须为空。只发布该输出目录，禁止发布整个 `.tmp` 或原始数据库/运行时 JSON。

`publication.json` 是逐图公开审核记录：

```json
{ "reviewedBy": "reviewer", "reviewedAt": "2026-09-26T00:00:00Z", "approvedImageSha256": ["审核过的图片 SHA256"] }
```

审核必须覆盖原型和实现图片中的手机号、真实个人资料、有效邀请/签到二维码等内容。未出现在白名单的图片不会发布，相应视觉通过状态会撤销。程序只做文字标识过滤，不能代替图片隐私审核；二维码不应仅靠手机号识别检查。若图片需要脱敏，重新审核脱敏后的 SHA，并在复核说明中记录脱敏及原截图来源，不能无说明替换证据。

`test-results.json` 将不同层级测试与截图验收分开：

```json
{
  "generatedAt": "2026-09-26T00:00:00Z",
  "cases": [{
    "id": "ordinary-profile",
    "stepIds": ["J2-01"],
    "mode": "test-account-service",
    "status": "pass",
    "summary": "普通测试账号资料接口返回成功",
    "evidence": "基于测试数据库账号调用服务方法，断言返回普通角色。",
    "limitations": ["未使用该账号完成真实微信登录"]
  }]
}
```

`mode` 仅允许 `test-account-service`（测试账号服务端）、`simulated-role`（模拟角色页面）、`devtools`（开发者工具真实会话）、`device`（微信真机）、`automated-contract`（自动化合同测试）。`status` 为 `pass` / `fail` / `pending`，已执行结果必须有 `evidence`。模拟或服务端通过不会升级截图视觉、交互或真机状态。文字只应填写对外可分享的结论，禁止塞入原始环境配置、凭证、身份数据和日志。

站点包含 noindex 和 noarchive，但这些不是访问控制。必须先完成内容公开审核再部署。

公开站对 `actual.source: "simulated-role"` 使用独立标签：只有双侧截图可公开，且视觉复核人、时间、说明与当前图片 SHA 完整绑定，才显示“模拟画面已核对”；不会显示真实视觉通过。角色和场景匹配时显示“场景：本地模拟”。模拟交互必须另有操作证据；即使输入错误标了真机通过，也会保持真机待测或范围未单列。原本的私密报告生成逻辑不受影响。

## 汇总角色测试结果

`merge-role-results.mjs` 读取采集目录中的 `captures.json`、`visual-review.json`、`summary.public.json` 和 `invoke-smoke.public.json`，合并已有 43 步清单，生成 `public-evidence.json`、`public-test-results.json`、`public-pending.json`，再构建公开站。原始私密 JSON 不进入站点。

```sh
node scripts/ui-fidelity/prototype-review/merge-role-results.mjs \
  --qa .tmp/role-qa-20260926 \
  --manifest .tmp/settings-move-20260926/manifest.json \
  --baseline-evidence .tmp/settings-move-20260926/evidence.json \
  --publication .tmp/public-review-audit/publication.json \
  --implementation CURRENT_COMMIT_OR_WORKTREE_LABEL \
  --out .tmp/miptest-site
```

只有当前截图 SHA 与复核记录一致，且采集状态为 ready 或 empty，才替换旧图。重新采集而尚未重新核对时，保留旧参考图并把本轮视觉项列为待测。真实数据库读取、本机派生边界、模拟画面和真机分别记录，不把成功加载当成写入操作通过。
