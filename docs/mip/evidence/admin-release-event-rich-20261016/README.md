# 活动富文本与表单对齐发布（2026-10-16）

## 范围

把「活动图文所见即所得 + 原型对齐表单」这一批改动发布到现有 CloudBase 后台环境（本机 `.env.local`，`MIP_DEPLOYMENT_STAGE=staging`），供用户自测。发布快照本地提交 `7d9486df`（未推送远端）。

改动面：

- 前端 `admin-web/`：TipTap 受限富文本编辑器、手机预览富文本 + 参与人、拖拽封面、标签胶囊 + 内置新建、分会归属默认、摘要隐藏、标题 20 字、字段顺序对齐原型、列表金额列名。
- 小程序 `src/`：`rich-content` 兼容受限 HTML 与存量 markdown，报名须知富文本化，HTML 插图水合（**尚未上传体验版**）。
- 云函数：`mip-admin-api`（富文本护栏 + 送审剥标签）、`mip-events-api`（签名直链重写兼容 HTML `<img>`）。
- 无数据库迁移。

## 发布与回读证据

| 层 | 结果 |
| --- | --- |
| 本地门禁 | `TZ=Asia/Shanghai pnpm verify:all` 通过（根 + Web + server 契约 + build + 响应式）；`git diff --check` 通过 |
| 业务函数 | `mip-admin-api`、`mip-events-api` 配置已更新、代码包 SHA 与本地一致；包内确认 `domain/rich-text.js`、`events.js` 的 `assertRichTextSafe`/`richTextToPlainText`、`event-service.js` 的 HTML 安全字符类 |
| BFF | `mip-admin-web-api` Active、禁客户端直调、无定时器、Cloudflare 未动；打包已并入上一版不可变 `/assets` 哈希资产（旧入口保留） |
| 静态 | 隔离前缀上传 15 文件 `VERIFIED`，共享根与 Cloudflare 未动 |
| 公开 HTTPS | 入口域数字节校验 15/15 匹配，新入口 `/assets/index-DA1pfRDB.js` |
| 端到端 | `verify-admin-cloudbase` 68 项通过、14 模块；`admin.mip.cool` 已提供新入口 |

**BLOCKED（沿用既有口径）**：原生 `Invoke` 健康探针被 CAM 拒绝（`[Invoke] Cam authentication failed`），与历轮一致；以配置/代码包回读与真实 HTTP 代替，不记为健康通过。

## 自测（用本机配置的管理员测试账号，读写真实数据）

- 登录 / `mip.admin.session` / `mip.admin.events.list` / 退出：通过。
- 新建活动（`mip.admin.events.save`）：通过，返回 DRAFT。
- 服务端规则命中：>20 字活动名称被拒、空摘要被拒（确认 20 字规则与摘要必填在服务侧生效）。
- 富文本回读：活动介绍、报名须知以受限 HTML（`strong`/`em`/`u`/`text-align`）持久化成功。
- 测试对象：一条 QA 命名的 DRAFT 活动（本机映射，可删除）；未发通知、未涉支付。

## 修复与二次发布（用户报告「新建标签失败」）

用户实测发现内联「新建并选中」失败。自查根因两处：

1. `mip.admin.events.catalog.save` 是 mutation，客户端会把 `idempotencyKey` 从 input 提到请求顶层；内联创建没有传，BFF 以 `IDEMPOTENCY_KEY_REQUIRED` 拒绝。
2. 服务端新建目录项状态为 `INACTIVE`，而可选项列表按 `status=ACTIVE` 过滤，新标签不会出现也无法用于活动。

修复：内联创建补幂等键，并在创建成功后再调 `mip.admin.events.catalog.changeStatus` 启用（`version` 来自创建响应）；失败时透出服务端信息。提交 `df3de52e`。

二次发布：静态 15 文件 VERIFIED，公开入口字节 15/15，新入口 `/assets/index-BUwiWcwA.js`；`verify-admin-cloudbase` 68 项通过。API 层边界自测（`create→activate→selectable`、重名/超 5 字/空名/空介绍/21 字标题/非 HTTPS 链接/付费无金额 均按预期拒绝）通过；QA 目录项用后归档清理。

## 第三次发布（用户反馈：富文本插图慢/无反馈、无法粘贴、坐标字段难用）

提交 `4faf9195`。改动：

- 富文本插图支持**剪贴板粘贴**与**拖拽文件**；上传立即给「正在上传图片…」反馈 + 工具栏转圈；**大图前端先缩到 1600px 内并转 JPEG**（1MB 原图经 BFF base64 的 7–8 秒等待显著下降）。
- 活动介绍媒体（contentMedia）移入「高级设置」并改「活动介绍图库（可选）」，明确正文插图直接在编辑器插入。
- 把两个数字字段「位置纬度/位置经度」换成单个「地图坐标（选填）」（高级设置，接受「纬度,经度」）。原型创建页**没有**坐标字段，仅场地地址文案 + 可选场地跳转链接。

发布：静态 15 文件 VERIFIED，公开入口字节 15/15，新入口 `/assets/index-CP3tQ7xp.js`；`admin.mip.cool` 已是该版本；`verify-admin-cloudbase` 68 项通过。门禁 `pnpm admin:web:verify` 通过（294 契约 + 182 React + build + 响应式）。

## 边界与待办

- 小程序端改动**未上传体验版**；在体验版更新前，新写的富文本在旧版小程序会按普通文本渲染（标签可见）。跨端展示需随后上传体验版验证。
- 真机支付/手机号/扫码签到不在本轮范围。
- 未执行生产发布授权；现有环境的 `stage=staging`，Cloudflare/旧站保留。
- 退款入口缺陷本轮只审计未修。
