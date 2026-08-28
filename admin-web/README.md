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

概览、用户、活动、订单、任务、Banner、战队、素材、机会与内容、成长与徽章、权限、消息、知识库和运营记录使用统一布局和导航。列表、详情和写操作均复用中立管理契约；真实请求失败时不会回退成演示状态。素材页按运营账号 capability 显示允许用途，支持 PNG/JPEG 本地预览、上传和素材 ID 复制。用户和订单页通过一次性导出票据下载当前筛选范围的数据；手机号列额外要求 `users.phone.read`，浏览器会复核文件大小、XLSX 文件头和 SHA-256 后再消费票据。

## 服务器端 BFF

Cloudflare Pages Function 位于 `functions/api/[[path]].ts`，核心 module 位于 `server/admin-bff.ts`。它完成：

- 网页生成 5 分钟有效的 8 位登录码，浏览器凭据只进入密封的 `HttpOnly` Cookie；
- 已有运营账号在小程序运营工作台确认登录码，CloudBase 按现有角色和 capability 重新鉴权；
- CloudBase 以独立 HMAC 将可信 AppID/OpenID 回传 BFF，D1 原子确认且仅允许消费一次；
- AES-GCM 密封的 `HttpOnly`、`Secure`、`SameSite=Lax` 8 小时会话；
- 严格同源检查；普通 `/api/admin` 保持 32 KB 请求上限和精确 action allowlist；
- 专用 `/api/media/image` 只接受 `mip.admin.media.uploadImage`，整体请求不超过 1.5 MB、解码图片不超过 1 MB，上游超时为 60 秒；
- mutation 必须携带业务幂等键，每次转发使用新的签名 nonce，网络失败不自动重试；
- 向 `mip-admin-api` 发送带 60 秒有效期和随机 nonce 的 HMAC envelope；
- 真实 `AUTH_REQUIRED`、`FORBIDDEN`、配置错误和上游错误状态。

BFF 不接受浏览器直接提交 `appId` 或 `openId`。CloudBase 侧只在小程序可信上下文和运营权限都通过后确认登录码；查询 adapter 只在 Web BFF HMAC 验证完成后签发 trusted principal，并再次执行原有 capability、scope 和审计逻辑。

## 部署前最小清单

1. 创建 D1 数据库 `mip-admin-auth`，将其以 `MIP_ADMIN_AUTH_DB` 绑定到 Pages 项目；示例见 `wrangler.d1.example.toml`。执行 `migrations/0001_web_login_challenges.sql`。
2. 为 Cloudflare 与 `mip-admin-api` 配置同一个 `MIP_ADMIN_WEB_LOGIN_HMAC_SECRET`，它只用于小程序确认网页登录；不要与查询 HMAC 复用。
3. 为 `mip-admin-api` 配置 `MIP_ADMIN_WEB_BFF_HMAC_SECRET`，并在 CloudBase HTTP 访问服务把一个 HTTPS 路径映射到该函数；将地址填入 Pages 的 `MIP_ADMIN_UPSTREAM_URL`。
4. 配置 `MIP_WEB_SESSION_SECRET`、`MIP_WEB_ALLOWED_APP_IDS`、`MIP_WEB_ALLOWED_ORIGIN=https://mipmini.01mvp.com`，关闭生产构建的 `VITE_MIP_ADMIN_DEMO_MODE`。
5. 在预发布环境验证错误登录码、过期/篡改 Cookie、重复消费、`AUTH_REQUIRED`、`FORBIDDEN`、上游超时和 AppID 不在 allowlist 的负向用例。
6. 确认导出存储签发的 HTTPS 临时地址允许 `https://mipmini.01mvp.com` 进行匿名 CORS `GET`；Web 不会把导出 token 写入 URL 或持久存储，CORS 不可用时下载会安全失败。
7. 验证素材上传的用途权限、PNG/JPEG 格式、1 MB 文件边界和 `cloud://` 返回值；浏览器只保留本地预览，不尝试直接加载 `cloud://`。

不需要把 CloudBase API Key、MySQL URI 或任何腾讯云管理凭证配置到浏览器或 Cloudflare。Cloudflare 只持有三项用途隔离的服务器密钥：会话密封、登录确认 HMAC、管理请求 HMAC。

Cloudflare Pages 的项目配置在 `wrangler.toml`；部署命令为 `pnpm deploy:pages`。自定义域名需要在 Cloudflare Pages 项目中绑定，首次绑定和 DNS 状态以 Cloudflare 控制台为准。

浏览器只显示随机短码并轮询同源 BFF，不接收可信身份字段。CloudBase 在执行前持久消费一次性 nonce；Web BFF 只允许契约清单中已审核且具有领域持久幂等保护的 mutation，其余写操作默认拒绝。素材上传使用独立路由，但复用同一会话、来源校验和服务端 HMAC principal，浏览器不会接收密钥。页面按当前账号 capability 显示操作入口，写操作均要求明确确认且不会自动重试。

官方能力依据：Cloudflare Pages Functions 支持 [D1 binding 与 secret](https://developers.cloudflare.com/pages/functions/bindings/)，D1 支持 [prepared statement 与条件写入](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)；CloudBase 官方支持用 [HTTP 访问服务把 HTTPS 路由映射到云函数](https://docs.cloudbase.net/service/access-cloud-function)。

## 边界

Web 工程不复制会员、活动、订单或权限规则。真实请求沿用 `AdminRequest v1`，CloudBase adapter 回到同一个 `AdminApplication.execute` seam；BFF 只处理浏览器会话、来源验证和 server-to-server transport。
