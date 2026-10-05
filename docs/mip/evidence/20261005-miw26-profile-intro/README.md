# 2026-10-05 MIW-26 填写信息页：一句话介绍字数与图标对齐设计稿

用户反馈：填写信息页（packages/member/mip-profile）「一句话介绍你的工作和背景」交付版显示 300 字符，实际设计稿为 160 字符；该区图标也与设计稿不一致。

## 修复

- 字数：还原分支（figmaLayout fixture）硬编码的 `0/300` 改为真实计数 `{{(figma.intro || '').length}}/160`。160 是服务端契约（`mip-identity-api/domain/service.js` `boundedText(headline, 0, 160)`）；生产表单本就是 `maxlength=160` + `{{headline.length}}/160`，未改。
- 图标：设计稿该区字形是 remix `survey-line`（黄色剪贴板清单，figma-restored 1774_41143 源矢量）。此前生产表单用近似字形 `file-text`、还原分支用裁坏的贴图 `icon-section-intro.png`（含文字残片）。把 `draft-line` / `survey-line` 按 DESIGN.md 图标命名补进 mip-icon 注册表，页面四个区块标题统一换成设计稿字形：
  - 基础信息 `contacts-1-1`（注册表已有，等于设计稿 contacts-line）
  - 代表行业 / 当前身份状态 `draft-line`
  - 一句话介绍 `survey-line`
  - 还原分支删除四张坏裁贴图（icon-section-people/industry/identity/intro.png），改用与生产一致的矢量，位置按设计稿 16×16 控制盒 + 矢量内偏移换算。
- 该修复同时消掉本页 3 个 `t-icon` 外来图标（user-avatar/file-edit/usergroup），属 PIXEL_RENDERING.md 记录的 SOT gap 补救路径。

## 前后对比

- `compare-intro-section.png` — 一句话介绍区设计稿 / 修复前 / 修复后放大对比
- `compare-figma-replica-full.png` — 还原分支整页前后（像素代理渲染）
- `compare-production-form-full.png` — 生产表单整页前后（临时 fixture 渲染，仅图标证据用，未加入 ui-fidelity 计分清单）
- `design-ref-figma.png` / `before-*.png` / `after-*.png` — 原始单帧

Layer 3 像素分：profile-编辑信息 97.27% → 97.29%（参考稿此细节仍是旧的 0/300，字数改为 160 有轻微代价，图标矢量补回更多）。

## 验收边界

截图来自 scripts/ui-fidelity/score-pixel.mjs 的 Webview 代理渲染，不是微信开发者工具或真机输出；生产表单帧由临时 fixture 渲染，不代表真实账号数据。参考稿 `figma-restored/pages/1774_41143_编辑信息.html`（ame-project 仓库）仍写 0/300，本次未改动设计证据仓库，是否刷新参考稿由设计侧决定。
