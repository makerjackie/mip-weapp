# MIP Web 管理后台架构

## 定位

`admin-web/` 是纯客户端 React 管理界面和同源 Cloudflare Pages/Worker BFF。它不重写 MIP 领域模型，也不让浏览器计算会员、活动资格、订单、支付、权限或审计事实。

```text
pages
  → React adapters / features
    → modules + services
      → same-origin Cloudflare BFF
        → signed AdminRequest v1
          → mip-admin-api AdminApplication.execute
            → domain modules / mip_* MySQL / outbox / media / export
```

## 目录职责

| 目录 | 职责 | 禁止 |
| --- | --- | --- |
| `src/app` | Router、QueryClient、主题、会话、错误边界和全局组合 | 领域查询格式化、页面业务规则 |
| `src/pages` | 路由级页面组合和 URL state | 直接 `fetch`、拼 AdminRequest、计算服务端事实 |
| `src/features` | 跨页面业务交互 adapter，例如详情、写操作、导出、上传 | 绕过 module validator 或 capability |
| `src/shared/ui` | PageHeader、FilterBar、DataTable、状态与反馈组件 | action 名称、领域 DTO、页面特例 |
| `src/modules` | 既有渠道中立 read model、detail、mutation definition 和 validator | React、DOM、Ant Design、浏览器会话 |
| `src/services` | AdminApiClient、同源 BFF transport、显式 demo adapter | 领域状态机和权限推断 |
| `server` | 会话、来源校验、限流、HMAC transport、请求 allowlist | 业务资格、金额、状态决定 |
| `functions` | Cloudflare Pages Function 薄 adapter | 页面逻辑或领域规则 |

## 深模块、interface、seam 与 adapter

- `AdminApiClient.request(action, input)` 是浏览器 transport module 的外部 interface；它隐藏响应 envelope、同源凭据和错误映射。
- `loadAdminReadPage`、`loadAdminDetail`、mutation definition/builder 是 React 与领域投影之间的 seam。React adapter 只消费其返回值。
- 真实 HTTP adapter 与显式 demo adapter 是该 seam 的两个 adapter。demo 只能在构建变量明确开启时选用，不能作为真实请求失败的回退。
- `SessionProvider` 是认证界面的 interface；短码轮询、恢复、退出和 AUTH_REQUIRED 处理留在实现内部。
- `MutationDialog` 通过 definition 驱动字段和校验；新页面不得为相同 action 再建一套 interface。

一个 module 只有在删除后会迫使多个调用者重复复杂性时才保留。仅转发 props 或重命名字段的浅层 wrapper 应删除。

## Router 与 URL state

TanStack Router 使用 hash history，保持 Cloudflare Pages 静态回退简单，并兼容现有分享链接。一级页面使用稳定路径：

`/overview`、`/users`、`/events`、`/orders`、`/tasks`、`/banners`、`/media`、`/game`、`/opportunities`、`/growth`、`/permissions`、`/messages`、`/knowledge`、`/operations`。

列表 search 包含 `q`、`status`、`cursor`、`page`、`tab`。页面不能另存一份可分享筛选状态；打开或关闭详情使用 React 局部状态，因为详情不是独立可分享业务入口。

## Query 与 mutation

- Query key 至少包含 route、筛选、cursor、limit 与 session identity boundary。
- Query 默认不自动重试 `AUTH_REQUIRED`、`FORBIDDEN`、`CONFLICT` 和 mutation。
- 成功 mutation 只失效相关 query；未知网络结果先刷新服务端事实，不盲目重放。
- mutation action、幂等键、`expectedVersion` 与 input 由既有 module builder 创建。

## AdminRequest v1 边界

平台中立 envelope 来自 workspace package `@mip/admin-contracts`：

```ts
{
  contractVersion: 1
  action: string
  input: Record<string, unknown>
  idempotencyKey?: string
}
```

业务 `action` 字段必须留在 `input` 内；顶层 action 只用于路由。浏览器只调用同源 `/api/admin` 与专用 `/api/media/image`，不得直接调用 CloudBase 或携带服务器密钥。

## 权限与服务端事实

- 导航与按钮使用 session capability 做体验层过滤；BFF 和 `mip-admin-api` 每次重新鉴权。
- 页面不构造可信 `appId`、`openId`、role、capability 或 scope。
- 会员、价格、报名、签到、退款、成长、战队计分和消息投递只展示服务端投影。
- 无接口时显示“暂不可用”或明确 demo 标识，不从已有字段推导生产结果。

## 错误与会话

`AdminApiClientError` 保留服务端 code、message 与 retryable。应用层统一映射：

- `AUTH_REQUIRED`：打开登录入口并停止受保护 query。
- `FORBIDDEN`：显示权限不足，不泄露角色细节。
- `CONFLICT`：刷新当前资源并要求重新确认。
- 5xx/网络：保留页面上下文，允许手动重试。

网页登录继续使用 5 分钟单次短码、浏览器 verifier、D1 原子确认和 AES-GCM `HttpOnly` 8 小时会话；React 不持久化 token。

## 测试策略

1. `src/modules`：保持 interface 级单元测试，覆盖 read model、validator、幂等输入和异常。
2. `src/services` / `server`：覆盖 response envelope、同源、Cookie、HMAC、allowlist、大小与超时。
3. React adapter：Testing Library 覆盖路由、筛选 URL、权限、加载/错误/空、表单校验和焦点恢复。
4. 运行时：1280×720、1440×900、390×844；验证无根级横向溢出、导航和主要交互可达。
5. 视觉：同一视口、同一状态下把 Workbuddy 与实现截图组成左右对照，再做 P0/P1/P2 修复循环。

## Cloudflare 部署

- Vite 输出 `dist/`，`public/_redirects` 保持 SPA 回退，`public/_headers` 保持安全头。
- `functions/api/[[path]].ts` 复用 `server/admin-bff.ts`。
- `wrangler.toml` 与现有 Pages 项目 `mip-admin-web`、D1 binding 继续复用。
- 自定义域名 `mipmini.01mvp.com` 的 DNS、密钥、生产变量和外部账号不由本次代码迁移自动变更。
