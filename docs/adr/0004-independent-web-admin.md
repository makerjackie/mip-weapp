# ADR 0004：独立 Web 管理端

状态：已接受，取代 ADR 0003 中“独立网页暂缓”的部分。

## 决策

保留小程序管理分包，并增加独立的 Web 管理端。Web 工程不复制 WXML，也不复制业务规则；它通过 `AdminRequest v1`、可信 Web principal 和 HTTPS transport 复用 `mip-admin-api` 的 operation、scope、审计和状态机。

## 当前边界

响应式 Web 界面与静态部署已经完成。代码中已形成同源 Pages Function、AES-GCM `HttpOnly` 会话、CloudBase HMAC 可信 principal adapter，以及会话、概览和用户列表三条只读 action。短期登录码的小程序确认、CloudBase HTTP 路由、两端密钥配置和真实数据浏览器验收尚未完成，因此在线版本仍只展示明确标记的演示数据。浏览器不得持有 CloudBase API Key、MySQL URI 或本机凭证。

## 结果

- 小程序管理分包继续支持手机现场操作与微信电脑端。
- Web 负责浏览器宽屏运营，不改变小程序技术栈。
- 服务端继续保持一个权威业务合同；权限、金额、状态和审计不在前端复制。
