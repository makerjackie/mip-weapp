# MIP Web 运营管理后台

独立的响应式 Web 管理端，不属于 `mip-weapp` Monorepo，也不复制小程序的 WXML。它与小程序复用同一套服务端管理操作语义：`AdminRequest v1`（`contractVersion`、`action`、`input`、可选 `idempotencyKey`）。

## 本地运行

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

没有配置 `VITE_MIP_ADMIN_API_URL` 时仅展示本地演示数据；配置 API 地址后，页面会使用 `fetch POST` 提交真实请求。访问令牌只保存在当前浏览器 sessionStorage，关闭当前会话即清除，不能提交到仓库。

## 当前模块

概览、用户、活动、订单、权限、消息、知识库已建立统一布局和导航。真实数据接入由 API 响应决定；服务端返回 `AUTH_REQUIRED` 或 `FORBIDDEN` 时，Web 端不自行推断权限，也不会把演示状态当作真实状态。

## 部署前最小清单

1. 提供可从浏览器访问的 HTTPS API 网关，转发到 `mip-admin-api`，并保留请求体原样。
2. 提供 `/auth/session` 一次性登录码交换端点；前端已支持 `?code=...` 回调交换短时会话，不要把 CloudBase API Key、MySQL URI 或函数密钥放入前端。
3. 配置 `VITE_MIP_ADMIN_API_URL`，在预发布环境验证 CORS、`AUTH_REQUIRED`、`FORBIDDEN`、`CONFLICT` 和 API 超时。
4. 将静态构建产物部署到 `mipmini.01mvp.com`，完成 DNS、HTTPS、CSP 和生产环境回滚方案后再切换域名。

Cloudflare Pages 的项目配置在 `wrangler.toml`；部署命令为 `pnpm deploy:pages`。自定义域名需要在 Cloudflare Pages 项目中绑定，首次绑定和 DNS 状态以 Cloudflare 控制台为准。

当前没有把 Web 端令牌直接当作登录实现。正式接入应由 HTTPS 网关提供 `/auth/session` 的一次性登录码交换，并通过 `HttpOnly`、`Secure`、`SameSite=Lax` Cookie 或短时访问令牌建立会话；前端不得接触 CloudBase API Key、MySQL URI 或函数密钥。现有令牌输入仅用于本地联调。

## 边界

当前目录未改动 `mip-weapp`、数据库、云函数或远端仓库。代表模块使用可替换的演示数据，完整 CRUD 页面应在 API 网关、Web 鉴权和正式视觉素材确认后继续接入。
