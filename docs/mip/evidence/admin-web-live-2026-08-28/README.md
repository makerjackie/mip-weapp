# 独立 Web 管理端线上验收

验收日期：2026-08-28。目标：`https://mipmini.01mvp.com/`。

## 身份闭环

1. 浏览器创建一次性短期登录 challenge。
2. 当前开发环境的真实运营管理员在微信开发者工具中确认。
3. 浏览器换取 `AUTHENTICATED` 的 `HttpOnly` 会话。
4. BFF 使用该会话签名访问 CloudBase；CloudBase 重新读取当前角色、capability 和 scope。

挑战码、Cookie、AppID、OpenID、环境标识、数据库地址和 HMAC 均未写入本证据或仓库。

## 线上读回

| 页面/能力 | action | HTTP | 当前开发环境条目数 |
| --- | --- | ---: | ---: |
| 会话 | `mip.admin.session` | 200 | 不适用 |
| 概览 | `mip.admin.dashboard.overview.get` | 200 | 不适用 |
| 用户 | `mip.admin.users.list` | 200 | 5 |
| 活动 | `mip.admin.events.list` | 200 | 5 |
| 订单 | `mip.admin.orders.list` | 200 | 5 |
| 运营角色 | `mip.admin.roles.list` | 200 | 1 |
| 城市分会 | `mip.admin.branches.list` | 200 | 4 |
| 消息活动 | `mip.admin.messageCampaigns.list` | 200 | 1 |
| 知识内容 | `mip.admin.knowledge.list` | 200 | 3 |

条目数只记录本次开发环境快照，不是固定业务口径。本次登录后线上验收时 BFF 开放 33 条受审只读 action；该次证据真实读取了用户详情、活动详情/洞察/报名名单、订单详情/支付尝试、消息活动详情和知识内容详情/采集计划。后续部署版本已经扩展到 80 条查询、80 条受审写 action、14 个一级页面和 8 类详情，并完成公开域名 200、未登录会话、静态资源指纹、390px/1280px 本地响应式，以及媒体接口同源未登录 401/跨站 403 的负向验证。由于当前 CloudBase 余额不足，本文件不把后续范围补写成登录后线上成功；未展示的 action 仍由 fail-closed 合同测试覆盖。

签名请求在进入 `AdminApplication` 前会把一次性 nonce 写入 `mip_web_bff_requests`；重复 nonce 或存储不可用时拒绝请求。4 条已有领域持久业务幂等保护的 mutation 已通过服务端精确白名单开放：补录会员、克隆活动、发布活动提醒和提交退款。后续 Web 版本已经部署对应表单，但本次线上验收没有制造业务写入，因此不把表单部署解释为真实写入结果通过。

## 当前 React 生产发布

- 仓库提交：`6613432` (`fix(admin-web): align server terminology`)
- Cloudflare Pages 生产部署：`39971feb-2f1c-4331-9a25-4603d653f848`
- 部署预览：`https://39971feb.mip-admin-web.pages.dev/`
- 生产域名：`https://mipmini.01mvp.com/`
- 公开入口：预览域名和生产域名均返回 HTTP 200，安全响应头保持生效。
- 资源指纹：生产入口引用 `index-B1_sdsTI.js`，线上与本地主资源 SHA-256 均为 `bc49f70d3dd3e8a18755076fa4fc7f88369ee51182f41ccd02a4113715d19f49`。
- BFF 边界：未登录同源 `POST /api/admin` 返回 HTTP 401 和 `AUTH_REQUIRED`，证明 Pages Functions 路由与会话门禁正在运行。

本次证据证明当前 React 构建已发布，不扩大为登录后查询、写入、上传、导出或 CloudBase 恢复证据。

## 边界

- 本证据证明线上身份闭环、7 个一级页面和 5 类真实详情查询可用。
- 本证据不证明 4 个网页写操作的真实业务结果、其余 CRUD、上传、导出、正式支付或手机号真机能力已完成。
- Web BFF 和 CloudBase adapter 都从生成的 operation contract 校验已开放 action 必须保持 `QUERY`、`safeToRetry=true`、认证和会话必需；合同漂移时失败关闭。`safeToRetry` 约束业务事实不重复，查询产生的访问审计不改变业务事实。
