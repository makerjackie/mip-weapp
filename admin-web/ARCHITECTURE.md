# MIP Web 管理后台架构

## 定位

`admin-web/` 是纯客户端 React 管理界面和同源 BFF，运行于 CloudBase：静态托管 + BFF 云函数 + 认证 MySQL adapter。它不重写 MIP 领域模型，也不让浏览器计算会员、活动资格、订单、支付、权限或审计事实。平台状态见项目状态，后续局部重构按 [EXECUTION_PLAN.md](EXECUTION_PLAN.md) 推进，不将计划中的接口当作已实现。

```text
pages
  → React adapters / features
    → modules + services
      → same-origin BFF (CloudBase function)
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
| `cloudbase` | CloudBase HTTP 网关入口薄 adapter（`index.ts`），转成标准 `Request` 后复用同一 BFF | 页面逻辑或领域规则 |

## 深模块、interface、seam 与 adapter

- `AdminApiClient.request(action, input)` 是浏览器 transport module 的外部 interface；它隐藏响应 envelope、同源凭据和错误映射。
- `loadAdminReadPage`、`loadAdminDetail`、mutation definition/builder 是 React 与领域投影之间的 seam。React adapter 只消费其返回值。
- 真实 HTTP adapter 与显式 demo adapter 是该 seam 的两个 adapter。demo 只能在构建变量明确开启时选用，不能作为真实请求失败的回退。
- `SessionProvider` 是认证界面的 interface；小程序码/数字码 challenge、轮询、恢复、退出和 AUTH_REQUIRED 处理留在实现内部。
- `MutationDialog` 通过 definition 驱动字段和校验；新页面不得为相同 action 再建一套 interface。

一个 module 只有在删除后会迫使多个调用者重复复杂性时才保留。仅转发 props 或重命名字段的浅层 wrapper 应删除。

## Router 与 URL state

TanStack Router 使用 hash history，保持静态托管的 SPA 回退简单，并兼容现有分享链接。一级页面使用稳定路径：

`/overview`、`/users`、`/cards`、`/events`、`/orders`、`/tasks`、`/banners`、`/videos`、`/media`、`/game`、`/opportunities`、`/growth`、`/permissions`、`/admin-accounts`、`/audit-logs`、`/messages`、`/knowledge`、`/operations`。

`/game`、`/knowledge` 已注册并按 capability 展示；导航可见性由当前服务端权限决定。

列表 search 包含 `q`、`status`、`cursor`、`page`、`limit`、`tab`。页面不能另存一份可分享筛选状态。当前多数详情使用 React 局部状态/抽屉，这是实现现状，不是全部详情的产品约束；用户档案由 `/users/$userId` 承载对象身份，支持独立 URL、浏览器 Tab 与多开（U02）。

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

action、query/mutation 分类、Web 暴露范围、mutation 字段白名单和幂等策略均由 `mip-admin-api` 生成到 `@mip/admin-contracts`；React adapter、BFF 与 CloudBase Web 入口消费同一份事实。业务 `action` 字段必须留在 `input` 内；顶层 action 只用于路由。浏览器只调用同源 BFF；`VITE_MIP_ADMIN_API_URL` 只能是以 `/` 开头的同源路径，默认使用 `/api/admin`，不得配置完整 URL 或跨源地址。媒体上传使用同源 `/api/media/image`，浏览器不得直接调用 CloudBase 或携带服务器密钥。

## BFF 路由

| 方法与路径 | 调用方 | 职责 |
| --- | --- | --- |
| `POST /api/auth/challenge` | 浏览器 | 创建 5 分钟有效的数字登录码；仅显式 `?qr=1` 额外请求可选小程序码 |
| `POST /api/auth/challenge/status` | 浏览器 | 轮询并一次性消费已确认登录 |
| `POST /api/auth/logout` | 浏览器 | 清除当前会话与登录挑战 Cookie |
| `POST /api/auth/password/login` | 浏览器 | 已绑定手机号与密码登录，不新增角色 |
| `GET /api/auth/password` | 已登录浏览器 | 读取密码配置状态和掩码手机号 |
| `POST /api/auth/password` | 已登录浏览器 | 近期小程序身份或当前密码验证后设置密码，撤销旧密码会话 |
| `POST /api/internal/auth/challenge/confirm` | CloudBase | 使用登录确认 HMAC 提交可信身份 |
| `POST /api/admin` | 浏览器 | 转发精确 allowlist 内的 AdminRequest v1 |
| `POST /api/media/image` | 浏览器 | 转发受控图片上传请求 |

BFF 通过 `MIP_ADMIN_UPSTREAM_HMAC_SECRET` 签名管理请求，CloudBase 的 `mip-admin-api` 通过 `MIP_ADMIN_WEB_BFF_HMAC_SECRET` 验签；两个变量必须保存同一个密钥值。登录确认使用独立的 `MIP_ADMIN_WEB_LOGIN_HMAC_SECRET`，动态小程序码生成使用 `MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET`；三个 HMAC 信任域必须互不复用。

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

小程序确认登录使用 5 分钟有效的单次 challenge、浏览器 verifier 和认证存储原子确认；认证存储使用 MySQL adapter（`d1Queries` 保留原 SQL 文本作为可移植测试方言与迁移参照）。数字码为该方式的默认入口，可选动态小程序码图片不持久化，React 不持久化或接收原始 scene。每个可信 AppID 与运营账号连续失败 5 次后锁定确认 5 分钟，同一客户端 IP 在 10 分钟内最多创建 30 个 challenge，认证存储只保存 HMAC 限流键。challenge IP 计数表不可用时该限流自动旁路，不阻断小程序确认流程。

可选密码登录沿用相同可信身份，使用独立的账号与来源计数，计数不可用时失败关闭。BFF 私有身份查询不在浏览器 action allowlist 内，只能经签名与防重放校验后向云端读取当前账号的验证手机号；浏览器仅得到掩码。两种方式都签发 AES-GCM `HttpOnly` 8 小时会话并逐请求验证对应认证存储的 session ID；密码版本改变使旧密码会话失效。参见 [ADR 0007](../docs/adr/0007-optional-admin-password-login.md)。

## 测试策略

1. `src/modules`：保持 interface 级单元测试，覆盖 read model、validator、幂等输入和异常。
2. `src/services` / `server`：覆盖 response envelope、同源、Cookie、HMAC、allowlist、大小与超时。
3. React adapter：Testing Library 覆盖路由、筛选 URL、权限、加载/错误/空、表单校验和焦点恢复。
4. 运行时：1280×720、1440×900、390×844；验证无根级横向溢出、导航和主要交互可达。
5. 视觉：同一视口、同一状态下把 Workbuddy 与实现截图组成左右对照，再做 P0/P1/P2 修复循环。

## CloudBase 部署

- Vite 输出 `dist/`，路由使用 `/#/...`。前端静态上传到隔离前缀（生产 `mip-admin-console/`，测试 `mip-admin-console-test/`），`/` 路由指向该前缀。
- 部署后除首页外，还要确认不存在的 `/assets/*.js` 返回 HTTP 404（由 BFF 内置的严格 `/assets` 处理器负责）；构建检查不能代替线上状态码验证。
- CloudBase HTTP 网关入口 `cloudbase/index.ts` 复用 `server/admin-bff.ts`；发布与回滚见 [CloudBase 运行说明](cloudbase/README.md)。
- 生产入口 `admin.mip.cool`，测试入口 `test.admin.mip.cool`；两者的函数名、静态前缀、认证 schema 与密钥完全独立，由目标目录的 `MIP_ADMIN_*` 配置选择。
