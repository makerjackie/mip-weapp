# MIP Web 运营管理后台

独立的响应式 Web 管理端，不属于 `mip-weapp` Monorepo，也不复制小程序的 WXML。它与小程序复用同一套服务端管理操作语义：`AdminRequest v1`（`contractVersion`、`action`、`input`、可选 `idempotencyKey`）。

## 本地运行

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

本地演示必须显式设置 `VITE_MIP_ADMIN_DEMO_MODE=true`。未启用演示时，浏览器只访问同源 `/api/admin`，页面不会在接口失败后回退成演示数据，也不会接触 CloudBase API Key、MySQL URI、身份提供方密钥或 BFF HMAC。

## 当前模块

概览、用户、活动、订单、权限、消息、知识库已建立统一布局和导航。当前真实只读链路仅开放 `mip.admin.session`、`mip.admin.dashboard.overview.get` 和 `mip.admin.users.list`；其余页面明确显示尚未接入，不会把演示状态当作真实状态。

## 服务器端 BFF

Cloudflare Pages Function 位于 `functions/api/[[path]].ts`，核心 module 位于 `server/admin-bff.ts`。它完成：

- 一次性登录 state、服务端 code exchange 和 AppID allowlist；
- AES-GCM 密封的 `HttpOnly`、`Secure`、`SameSite=Lax` 8 小时会话；
- 严格同源检查、32 KB 请求上限和只读 action allowlist；
- 向 `mip-admin-api` 发送带 60 秒有效期和随机 nonce 的 HMAC envelope；
- 真实 `AUTH_REQUIRED`、`FORBIDDEN`、配置错误和上游错误状态。

身份提供方必须从自己的受信来源验证登录码，并明确返回 `{ verified: true, appId, openId, displayName? }`。BFF 不接受浏览器直接提交 `appId` 或 `openId`。CloudBase 侧对应 adapter 只在 HMAC 验证完成后签发 trusted principal，并再次执行原有 capability、scope 和审计逻辑。

## 部署前最小清单

1. 配置受信身份提供方的 authorize/exchange URL、client ID/secret 和允许的 MIP AppID；exchange 必须返回与小程序运营身份可映射的真实 OpenID。
2. 为 `mip-admin-api` 配置 `MIP_ADMIN_WEB_BFF_HMAC_SECRET`，并提供指向该函数的 HTTPS 上游 URL；同一 HMAC 只以 Cloudflare secret 配置在 BFF。
3. 配置 `MIP_WEB_SESSION_SECRET`、`MIP_WEB_ALLOWED_ORIGIN=https://mipmini.01mvp.com`，关闭生产构建的 `VITE_MIP_ADMIN_DEMO_MODE`。
4. 在预发布环境验证登录回调、过期/篡改 Cookie、`AUTH_REQUIRED`、`FORBIDDEN`、上游超时和 AppID 不在 allowlist 的负向用例。

Cloudflare Pages 的项目配置在 `wrangler.toml`；部署命令为 `pnpm deploy:pages`。自定义域名需要在 Cloudflare Pages 项目中绑定，首次绑定和 DNS 状态以 Cloudflare 控制台为准。

当前实现不提供浏览器令牌输入。登录码只由 Pages Function 与身份提供方交换；浏览器得到的是密封会话 Cookie。写操作尚未开放，因为 mutation 还需要持久化 nonce/idempotency 防重放存储，不能沿用当前只读 envelope 直接放行。

## 边界

Web 工程不复制会员、活动、订单或权限规则。真实请求沿用 `AdminRequest v1`，CloudBase adapter 回到同一个 `AdminApplication.execute` seam；BFF 只处理浏览器会话、来源验证和 server-to-server transport。
