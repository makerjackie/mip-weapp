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
| `src/app` | Router、`route-pages.tsx` 路由组合、QueryClient、主题、会话和错误边界 | 领域查询格式化、页面业务规则 |
| `src/features` | React 页面视图和交互 adapter，包括列表、详情、写操作、导出和上传 | 直接 `fetch`、拼 AdminRequest、绕过 module validator 或 capability |
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
- Query 对 `AUTH_REQUIRED`、`FORBIDDEN` 和 `CONFLICT` 不重试；其他查询失败最多重试一次。
- 成功 mutation 当前会失效全部 Query 缓存，由各可见页面重新读取服务端事实；在没有完整 action-to-query 依赖表前不缩小失效范围。
- mutation 不自动重放；失败时保留表单上下文并显示服务端或网络错误。
- mutation action、幂等键、`expectedVersion` 与 input 由既有 module builder 创建。

## AdminRequest v1 边界

平台中立 envelope 来自 workspace package `@mip/admin-contracts`：

```ts
interface AdminRequest<A extends AdminOperationAction> {
  contractVersion: 1
  action: A
  input: Record<string, unknown>
  idempotencyKey?: string
}
```

action、query/mutation 分类、Web 暴露范围、mutation 字段白名单和幂等策略均由 `mip-admin-api` 生成到 `@mip/admin-contracts`；React adapter、Cloudflare BFF 与 CloudBase Web 入口消费同一份事实。业务 `action` 字段必须留在 `input` 内；顶层 action 只用于路由。浏览器只调用同源 BFF；`VITE_MIP_ADMIN_API_URL` 只能是以 `/` 开头的同源路径，默认使用 `/api/admin`，不得配置完整 URL 或跨源地址。媒体上传使用同源 `/api/media/image`，浏览器不得直接调用 CloudBase 或携带服务器密钥。

## BFF 路由

| 方法与路径 | 调用方 | 职责 |
| --- | --- | --- |
| `POST /api/auth/challenge` | 浏览器 | 创建 5 分钟有效的登录短码 |
| `POST /api/auth/challenge/status` | 浏览器 | 轮询并一次性消费已确认登录 |
| `POST /api/auth/logout` | 浏览器 | 清除当前会话与登录挑战 Cookie |
| `POST /api/internal/auth/challenge/confirm` | CloudBase | 使用登录确认 HMAC 提交可信身份 |
| `POST /api/admin` | 浏览器 | 转发精确 allowlist 内的 AdminRequest v1 |
| `POST /api/media/image` | 浏览器 | 转发受控图片上传请求 |

Pages 通过 `MIP_ADMIN_UPSTREAM_HMAC_SECRET` 签名管理请求，CloudBase 的 `mip-admin-api` 通过 `MIP_ADMIN_WEB_BFF_HMAC_SECRET` 验签；两个变量必须保存同一个密钥值。登录确认使用独立的 `MIP_ADMIN_WEB_LOGIN_HMAC_SECRET`，不得与管理请求 HMAC 复用。

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

网页登录使用 5 分钟有效的 6 位数字单次短码、浏览器 verifier、D1 原子确认和 AES-GCM `HttpOnly` 8 小时会话；每个可信 AppID 与运营账号连续失败 5 次后锁定确认 5 分钟，D1 只保存该主体的 HMAC 限流键。React 不持久化 token。

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
