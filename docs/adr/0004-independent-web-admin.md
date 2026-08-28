# ADR 0004：独立 Web 管理端

状态：已接受，取代 ADR 0003 中“独立网页暂缓”的部分。

## 决策

保留小程序管理分包，并增加独立的 Web 管理端。Web 工程不复制 WXML，也不复制业务规则；它通过 `AdminRequest v1`、可信 Web principal 和 HTTPS transport 复用 `mip-admin-api` 的 operation、scope、审计和状态机。

## 当前边界

响应式 React Web 已从源码 `c21b3b4` 部署到 `https://mipmini.01mvp.com/`，Cloudflare Pages deployment ID 为 `22429e0f-344a-49af-8fb8-e76a75f86507`。真实管理员在微信侧确认网页登录后，浏览器进入 `AUTHENTICATED`，14/14 个一级路由均已通过生产真实只读验收。

生产写入证据保持最小且可回收：真实 JPEG 通过同源媒体入口上传，用于保存 `INACTIVE` Banner，随后通过服务端软删除；用户敏感导出使用 `includesPhone=false` 和唯一无匹配条件，结果 `rowCount=0`，HTTPS 下载的 ZIP magic、字节数和 SHA-256 校验一致，ticket 最终为 `CONSUMED`，验收进程内文件字节已清零。CloudBase 核心及修复函数已部署且 `pnpm cloud:verify` 通过；微信开发者工具最终报告 `.tmp/runtime-evidence/2026-08-28-final-r6/report.json` 已通过 110/110 路由、6/6 代表状态、6/6 交互旅程，diagnostics 为 0。证据见 [2026-08-28 React Web 线上验收](../mip/evidence/admin-web-live-2026-08-28-react/README.md)。此前范围较小的历史证据继续保留，不替代当前版本结论。

浏览器不得持有云平台管理密钥、数据库连接信息或本机凭证。未接入真实 API 的页面壳层不能作为业务完成证据，真实请求失败时也不得回退为演示数字。

“服务器”是产品 UI 对城市分会的习惯称谓；服务端模型、数据库表、`branch` 合同和权限范围继续使用 branch / city branch，不新增通用服务器或租户模型。正式支付、手机号与扫码等真机能力、AI/provider、外部消息投递以及 Mac/Windows 微信客户端仍需独立验收；一次 Banner JPEG 与零行无手机号导出不能外推为全部媒体和敏感导出场景通过。

## 结果

- 小程序管理分包继续支持手机现场操作与微信电脑端。
- Web 负责浏览器宽屏运营，不改变小程序技术栈。
- 服务端继续保持一个权威业务合同；权限、金额、状态和审计不在前端复制。
