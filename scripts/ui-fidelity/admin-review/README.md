# 管理后台共享验收页

生成独立的 `out/admin/index.html`，不改动同目录的小程序验收页。输出目录中的 `admin/` 必须为空。

```sh
node scripts/ui-fidelity/admin-review/build.mjs \
  --checklist .tmp/admin-acceptance-20260927/checklist.json \
  --captures .tmp/admin-acceptance-20260927/captures.public.json \
  --out .tmp/miptest-next
```

清单格式：`{title, items:[{id, route, title, requirements:[], notes}]}`。

截图格式：

```json
{
  "generatedAt": "2026-09-27T00:00:00Z",
  "captures": [{
    "id": "overview",
    "route": "/overview",
    "title": "桌面概览",
    "image": "screenshots/overview-desktop.png",
    "approved": true,
    "sha256": "已公开审核的图片 SHA256",
    "mode": "demo-visual",
    "status": "pass",
    "notes": "显式演示模式，仅验证布局。",
    "operations": ["打开概览，检查内容与布局"],
    "viewport": { "width": 1440, "height": 900 },
    "capturedAt": "2026-09-27T00:00:00Z"
  }]
}
```

图片路径相对截图 JSON 所在目录，同一步可有多个视口。只有 `approved:true` 且 SHA 一致的 PNG/JPEG/WebP 才会复制。未审核图片不会读取或发布；已审核但 SHA 不符直接阻止构建。输入只允许公开清单和公开截图记录，不读取 private 响应。图片需人工审核手机号、真实个人资料、登录码、二维码与凭据；SHA 校验不代替该审核。

`mode` 可为 `demo-visual`、`real-read`、`real-write`。缺少图片或操作证据保留待测；演示通过仅显示“演示画面已检查”，不能证明真实读取/写入。真实读成功仍提示写入未验证。

逐页意见通过 localStorage 保存在验收者自己的浏览器，可导出包含全部页面（含尚未验收项）的 JSON。网站不提交后台操作，不自动汇总伙伴意见。`noindex` 不等于访问控制，只能发布审核后的内容。
