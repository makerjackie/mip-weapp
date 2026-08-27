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

条目数只记录本次开发环境快照，不是固定业务口径。本次线上验收时 BFF 开放 33 条受审只读 action；当前源码已扩展为 62 条。除一级页面外，本次还真实读取了用户详情、活动详情/洞察/报名名单、订单详情/支付尝试、消息活动详情和知识内容详情/采集计划。未在本次线上快照中展示的 action 仍由 fail-closed 合同测试覆盖，不据此宣称已经完成线上逐项验收。

签名请求在进入 `AdminApplication` 前会把一次性 nonce 写入 `mip_web_bff_requests`；重复 nonce 或存储不可用时拒绝请求。4 条已有领域持久业务幂等保护的 mutation 已通过服务端精确白名单开放：补录会员、克隆活动、发布活动提醒和提交退款。后续 Web 版本已经部署对应表单，但本次线上验收没有制造业务写入，因此不把表单部署解释为真实写入结果通过。

## 边界

- 本证据证明线上身份闭环、7 个一级页面和 5 类真实详情查询可用。
- 本证据不证明 4 个网页写操作的真实业务结果、其余 CRUD、上传、导出、正式支付或手机号真机能力已完成。
- Web BFF 和 CloudBase adapter 都从生成的 operation contract 校验已开放 action 必须保持 `QUERY`、`safeToRetry=true`、认证和会话必需；合同漂移时失败关闭。`safeToRetry` 约束业务事实不重复，查询产生的访问审计不改变业务事实。
