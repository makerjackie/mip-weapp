# 会员演示内容配置回读

2026-09-26，当前 staging / TEST / test payment 环境，经项目唯一 CloudBase MCP 通道写入并回读。用户已明确授权先填演示内容，后续由管理员修改。身份、环境和密钥未进入产物。

- 4 项 ACTIVE 演示权益，各关联到现有 3 个演示等级；此前等级均未关联权益。已有 1 项草稿权益保留。
- 新增 4 项 PUBLISHED 演示任务，均为全员任务且有审核负责人。经验奖励分别 50 / 60 / 80 / 100，贡献奖励按任务为 0 / 10 / 20，现金奖励关闭。保留原有 3 项任务。
- 普通用户使用协议新增为演示版 1，406 字；现有会员服务协议演示版 1（248 字）保留。
- 不修改账号角色或会员资格；不创建任务提交、完成、成长流水或奖励发放。

脱敏数据库事实见 [readback.json](readback.json)。受控初始化脚本为 `scripts/seed-membership-content-demo.mjs`；完成后重复运行保留管理员改动。后续通过 Web 成长管理维护权益、等级关联和两类协议，任务管理维护任务与奖励。

此证据证明配置写入与回读。2026-09-26 19:46–19:48（北京时间）已部署 `mip-identity-api` 与 `mip-admin-api`；两项均回读为 Active / Available、Nodejs20.19，MySQL health 正常。发布记录见 [identity-deploy.json](identity-deploy.json)、[admin-deploy.json](admin-deploy.json)；代码哈希与两种协议正文摘要见 [deployment.json](deployment.json)。部署后的独立 `cloud:verify` 已通过，覆盖 schema、最小权限、全部核心函数健康与受保护调用规则。

Web 已以版本化资源目录 `assets/release-parity-20260926` 部署到 [7a562cf0](https://7a562cf0.mip-admin-web.pages.dev)，正式入口为 [MIP 管理后台](https://mipmini.01mvp.com)。发布记录与 HTTP 资源回读见 [web-deployment.json](web-deployment.json)。

真实已登录微信开发者工具会话已分别打开用户协议与会员协议，均为 `ready` 状态，实际正文摘要与数据库回读完全一致：用户协议 406 字、会员协议 248 字，均演示版 1。脱敏运行时证据见 [session-readback.json](session-readback.json)，实际渲染见 [用户协议截图](user-agreement.png) 与 [会员协议截图](membership-agreement.png)。未提交包含会话上下文的 private 原始文件。

这里验证的是已部署 API 的真实小程序会话与页面渲染，不代表物理手机验收；Web 的证据为正式域名资源一致性，未据此声称完成 Web 编辑/保存流程验收。

## 后台内容编辑提交修复

逐页验收时，真实后台独立合作卡编辑页暴露出“填写完整仍无法提交”：独立页没有调用弹窗已有的内容转换，缺少 `draft.kind` 且带入隐藏角色/案例字段；案例可选素材为空时也会被拒绝。独立机会编辑页同样遗漏角色多选和空商业条件转换。本次将原有转换提取为同一模块，三种独立编辑页与弹窗保持一致；合作卡不再显示仅案例可用的封面上传。不放宽原有严格字段校验。

`pnpm admin:web:verify` 通过：150 项合同测试、71 项 React 测试，包含真实表单切换角色、切换内容类型、多选机会角色的提交回归；类型检查、lint、构建和响应式契约也通过。已部署 [2cb32a54](https://2cb32a54.mip-admin-web.pages.dev)，资源目录 `assets/release-forms-20260926`；正式域名与部署域名 HTML、12 份 JS/CSS 资源哈希均与本地产物相同。证据见 [user-content-form-web-deployment.json](user-content-form-web-deployment.json)。主验收流程已通过真实已登录 Web UI 成功创建演示合作卡、案例、机会，并完成机会发布。随后独立按归属用户与演示标题只读查询，三种内容各 1 条；合作卡与案例为 PUBLISHED，机会在后续回读时为 UNPUBLISHED。状态变化由主流程验收管理，本证据检查未写入数据；mock 请求测试与真实创建、数据库回读分开记录。

## 机会说明选填部署

原型中的“展开讲讲”是选填，但用户端 API 原本强制必填。本轮只部署 `mip-opportunities-api` 的选填修复，保持已有 6000 字服务端上限以兼容历史内容，未部署其他函数、未改后台/AI 上限。修复负责人确认服务端 13 项与客户端 29 项聚焦测试通过；部署流程通过后独立回读为 Active / Available、Nodejs20.19、MySQL health 正常。发布时刻为 2026-09-26 20:35:13（北京时间），代码 SHA 与验证边界见 [opportunity-optional-description-deployment.json](opportunity-optional-description-deployment.json)。真实小程序选填提交由主验收继续验证；此次部署和证据读取没有写入用户内容。

## 真实保存失败的脱敏诊断

真实小程序清空机会说明后保存，出现“机会服务暂时不可用”。选填校验测试已通过，现有调用日志通道无法提供内部异常，因此暂未将原因归结为选填或公网配置。机会函数追加最小可诊断错误：内容检查不可用时返回 `CONTENT_SAFETY_UNAVAILABLE` 和固定网络码/纯整数 `providerCode`，用户文案为“内容检查暂不可用，请稍后重试”。不返回原始错误、URL、内容、身份或令牌；只有检查结果明确 pass 才继续保存。未更改网络、VPC 或权限。

机会函数 142 项测试通过；最终版本补充了 SDK 抛出 87014 时归类为内容拒绝，于 21:11:44（北京时间）部署并健康回读通过；证据见 [opportunity-content-safety-diagnostic-deployment.json](opportunity-content-safety-diagnostic-deployment.json)。主验收随后从真实保存响应读取到 `CONTENT_SAFETY_UNAVAILABLE / providerCode=-604101`，与官方 SDK 和[官方说明](https://docs.cloudbase.net/faq/knowledge/cloud-call-604101-permission-error)一致，根因为微信云调用接口权限未生效。本地 `config.json` 已仅声明 `security.msgSecCheck`，但通用 SCF 代码上传不等于微信权限同步；待通过微信专有配置入口同步并真实重试。未启用公网，不能将健康回读当作保存成功。
