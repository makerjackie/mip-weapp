# ADR 0004：独立 Web 管理端

状态：部分被 [ADR 0005](0005-web-admin-and-onsite-workbench.md) 取代。

## 决策

保留小程序管理分包，并增加独立的 Web 管理端。Web 工程不复制 WXML，也不复制业务规则；它通过 `AdminRequest v1`、可信 Web principal 和 HTTPS transport 复用 `mip-admin-api` 的 operation、scope、审计和状态机。

## 边界

- 浏览器不得持有云平台管理密钥、数据库连接信息或本机凭证。
- 未接入真实 API 的页面壳层不能作为业务完成证据，真实请求失败时不得回退为演示数据。
- “服务器”是产品 UI 对城市分会的习惯称谓；服务端模型、数据库表、`branch` 合同和权限范围继续使用 branch / city branch，不新增通用服务器或租户模型。
- 当前部署和验收状态只在 [MIP 项目状态](../mip/PROJECT_STATUS.md) 与对应证据中维护。

## 结果

- 小程序管理分包继续支持手机现场操作；“微信电脑端宽屏运营”已由 ADR 0005 取代。
- Web 负责浏览器宽屏运营，不改变小程序技术栈。
- 服务端继续保持一个权威业务合同；权限、金额、状态和审计不在前端复制。
