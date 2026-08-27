# 独立 Web 管理端线上只读验收

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

条目数只记录本次开发环境快照，不是固定业务口径。BFF 另开放并测试 `rolePolicies.list`、`audit.list` 和 `messageTemplates.list`，合计 12 条只读 action；当前一级页面未单独展示这三张表。

## 边界

- 本证据证明线上身份闭环和第一批真实只读查询可用。
- 本证据不证明详情、编辑、上传、导出、支付、手机号或任何 mutation/CRUD 已完成。
- Web BFF 和 CloudBase adapter 都从生成的 operation contract 校验已开放 action 必须保持 `QUERY`、`safeToRetry=true`、认证和会话必需；合同漂移时失败关闭。
