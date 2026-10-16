# MIP Web 运营管理后台

位于 `mip-weapp/admin-web/` 的独立构建、独立部署 React 管理端。它属于根 pnpm workspace，但不引用小程序的 `wx`、WXML、TDesign MiniProgram 或页面代码。Web 与小程序只复用平台中立的 `AdminRequest v1` 管理操作语义（`contractVersion`、`action`、`input`、可选 `idempotencyKey`）以及同一套服务端事实。

## 本地运行

做后台产品验收只看 [ACCEPTANCE.md](ACCEPTANCE.md)；当前差距见[覆盖矩阵](../docs/mip/COVERAGE_MATRIX.md#管理端)，伙伴改动及版本关系见[2026-09-29 审查](../docs/mip/evidence/admin-audit-20260929/README.md)。`INTERACTION_SPEC.md`、`FORM_AUDIT.md` 是工程指南和历史排查，不是另一套验收标准。

修复与完整交付按 [EXECUTION_PLAN.md](EXECUTION_PLAN.md) 的工作包执行；模型接手从 W00 开始，进度写项目状态，不能把执行计划当作通过证明。

### 演示模式

```bash
cp admin-web/.env.example admin-web/.env.local
pnpm install
pnpm admin:web:dev
```

在 `admin-web/.env.local` 中保留 `VITE_MIP_ADMIN_API_URL=/api/admin`，并设置 `VITE_MIP_ADMIN_DEMO_MODE=true`。演示模式只使用本地演示数据，不启动同源 BFF，也不提交写操作。

### 真实 BFF

真实同源 BFF 运行在 CloudBase：前端静态托管 + BFF 云函数 + 认证 MySQL schema。本地构建真实产物用 `VITE_MIP_ADMIN_DEMO_MODE=false pnpm admin:web:build`，发布到目标和验证按 [CloudBase 运行说明](cloudbase/README.md) 与 [mip-admin-release skill](../.agents/skills/mip-admin-release/SKILL.md)。`VITE_MIP_ADMIN_API_URL` 只允许配置以 `/` 开头的同源路径，默认并推荐使用 `/api/admin`；不要填写协议、域名或跨源地址。登录确认要求 CloudBase 能访问对应 BFF 的内部确认端点。

完整本地门禁使用 `pnpm admin:web:verify`；小程序与 Web 的合并门禁使用 `pnpm verify:all`。

未启用演示时，页面不会在接口失败后回退成演示数据。浏览器不会接触 CloudBase API Key、MySQL URI、身份提供方密钥或 BFF HMAC。

## 当前模块

概览、用户、名片、活动、订单、任务、Banner、素材、机会与内容、成长与勋章、权限、后台账号、审计日志、消息和运营记录使用统一布局和导航。列表、详情和写操作均复用中立管理契约；真实请求失败时不会回退成演示状态。素材页按运营账号 capability 显示允许用途，支持 PNG/JPEG 本地预览、上传和素材 ID 复制。用户和订单页通过一次性导出票据下载当前筛选范围的数据；活动详情也可导出该活动反馈。手机号列额外要求 `users.phone.read`，浏览器会复核文件大小、XLSX 文件头和 SHA-256 后再消费票据。

## 服务器端 BFF

后台支持可选的手机号密码登录，并保留小程序确认入口。首次设置或忘记密码时，先用小程序确认登录，再在账号菜单设置密码；密码会话修改密码需验证当前密码，修改成功后重新登录。手机号来自现有身份服务的已验证绑定，不能在密码设置表单指定另一账号。密码登录不会自动创建会员或授予管理权限。

CloudBase 认证表由 `scripts/setup-admin-cloudbase-auth.mjs` 应用 `migrations/mysql/0001_admin_auth.sql` 初始化，日常发布不重复建库。`migrations/0001`–`0004` 的 SQLite SQL 仅用于本地认证测试，不是线上迁移入口；会话协议升级后需要重新登录。密码使用 PBKDF2-SHA256、随机盐和服务端 pepper，认证 MySQL schema 保存密码派生结果及 HMAC 手机号索引，不保存明文密码。现有服务端在密码登录时复核当前手机号、身份与运营权限，业务操作继续重新授权。详细边界见 [ADR 0007](../docs/adr/0007-optional-admin-password-login.md)。

自动化登录冒烟：在仓库根目录被 Git 忽略的 `.env.secrets.local` 中配置 `MIP_ADMIN_TEST_ORIGIN`、`MIP_ADMIN_TEST_PHONE`、`MIP_ADMIN_TEST_PASSWORD`，然后运行 `node scripts/admin-password-smoke.mjs`。它通过真实密码登录读取管理员会话并退出，不绕过鉴权、不修改业务数据，也不打印凭证。

BFF 核心 module 位于 `server/admin-bff.ts`，CloudBase HTTP 网关入口位于 `cloudbase/index.ts`。它完成：

- 切换到小程序登录时生成 5 分钟有效的 6 位数字登录码，不调用或等待小程序码接口；仅显式 `?qr=1` 请求可选小程序码；浏览器凭据只进入密封的 `HttpOnly` Cookie；
- 已有运营账号在小程序现场工作台输入数字码并明确确认，开发版和体验版均可使用；可选扫码进入专用确认页；CloudBase 按现有角色和 capability 重新鉴权；
- 小程序码图片只在本次响应中返回，不写对象存储；浏览器响应不包含 challenge token、AppID 或 OpenID；
- CloudBase 以独立 HMAC 将可信 AppID/OpenID 回传 BFF，认证存储原子确认且仅允许消费一次；
- 每个可信 AppID 与运营账号连续失败 5 次后锁定确认 5 分钟，限流键只保存不可逆 HMAC；
- 同一客户端 IP 在 10 分钟内最多创建 30 个登录码，限流键同样只保存 HMAC；该表不可用时自动旁路，不阻断登录；
- AES-GCM 密封的 `HttpOnly`、`Secure`、`SameSite=Lax` 8 小时会话，并通过认证存储 session ID 校验有效性；退出撤销当前会话，密码变更撤销旧密码会话；
- 严格同源检查；普通 `/api/admin` 保持 32 KB 请求上限和精确 action allowlist；
- 专用 `/api/media/image` 只接受 `mip.admin.media.uploadImage`，整体请求不超过 1.5 MB、解码图片不超过 1 MB，上游超时为 60 秒；
- mutation 必须携带业务幂等键，每次转发使用新的签名 nonce，网络失败不自动重试；
- 向 `mip-admin-api` 发送带 60 秒有效期和随机 nonce 的 HMAC envelope；
- 真实 `AUTH_REQUIRED`、`FORBIDDEN`、配置错误和上游错误状态。

BFF 不接受浏览器直接提交 `appId` 或 `openId`。CloudBase 侧只在小程序可信上下文和运营权限都通过后确认登录请求；查询 adapter 只在 Web BFF HMAC 验证完成后签发 trusted principal，并再次执行原有 capability、scope 和审计逻辑。

## 部署前最小清单

CloudBase 同构部署：生产与测试同一套架构、不同命名与密钥；目标由本机 `envs/<target>` 目录的 `MIP_ADMIN_*` 配置选择。完整发布顺序、回滚与三层证据见 [CloudBase 运行说明](cloudbase/README.md) 与 [mip-admin-release skill](../.agents/skills/mip-admin-release/SKILL.md)。

1. 认证存储使用独立 MySQL schema（生产 `mip_admin_auth`，测试 `mip_test_admin_auth`）与专用最小权限账号；用 `scripts/setup-admin-cloudbase-auth.mjs` 初始化，schema 由 `MIP_ADMIN_AUTH_SCHEMA` 选择，账号按 (EnvID, schema) 派生。
2. BFF 的 `MIP_ADMIN_UPSTREAM_HMAC_SECRET` 与上游 `mip-admin-api` 的 `MIP_ADMIN_WEB_BFF_HMAC_SECRET` 同值异名配对；登录确认用 `MIP_ADMIN_WEB_LOGIN_HMAC_SECRET`，小程序码用 `MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET`；三个 HMAC 信任域互不复用。`MIP_ADMIN_UPSTREAM_URL` 指向对应上游（生产 `mip-admin-api`，测试 `mip-t-admin-api`）。
3. 配置 `MIP_WEB_SESSION_SECRET`、`MIP_WEB_ALLOWED_APP_IDS`、`MIP_WEB_ALLOWED_ORIGIN`（生产 `https://admin.mip.cool`，测试 `https://test.admin.mip.cool`），关闭生产构建的 `VITE_MIP_ADMIN_DEMO_MODE`。
4. 可选扫码要求目标小程序版本包含 `packages/admin/web-login-confirm/index`；云函数配置 `MIP_ADMIN_WEB_LOGIN_QR_ENV_VERSION=trial|develop|release`，并确认 `mip-admin-api`/`mip-t-admin-api` 的 `config.json` 已含 `wxacode.getUnlimited` 权限。
5. 在预发布环境验证错误/过期 scene、错误数字码、篡改 Cookie、重复消费、`AUTH_REQUIRED`、`FORBIDDEN`、上游超时和 AppID 不在 allowlist 的负向用例。
6. 确认导出存储签发的 HTTPS 临时地址允许对应后台 origin 进行匿名 CORS `GET`；Web 不会把导出 token 写入 URL 或持久存储，CORS 不可用时下载会安全失败。
7. 验证素材上传的用途权限、PNG/JPEG 格式、1 MB 文件边界和 `cloud://` 返回值；浏览器只保留本地预览，不尝试直接加载 `cloud://`。

不需要把 CloudBase API Key、MySQL URI 或其他管理凭证配置到浏览器。BFF 云函数只持有四项用途隔离的服务器密钥：会话密封、登录确认 HMAC、小程序码生成 HMAC、管理请求 HMAC。

发布路径：隔离静态前缀（生产 `mip-admin-console/`，测试 `mip-admin-console-test/`）→ BFF 云函数（生产 `mip-admin-web-api`，测试 `mip-t-admin-web-api`）→ 网关三条路由（`/`、`/api`、`/assets`）。生产入口 `admin.mip.cool`，测试入口 `test.admin.mip.cool`；自定义域名的证书与 DNS 流程见 [custom-domain.md](../.agents/skills/mip-admin-release/references/custom-domain.md)。

当前浏览器界面只显示数字登录码并轮询同源 BFF，不接收可信身份字段或原始 scene。CloudBase 在执行前持久消费一次性 nonce；Web BFF 只允许契约清单中已审核且具有领域持久幂等保护的 mutation，其余写操作默认拒绝。素材上传使用独立路由，但复用同一会话、来源校验和服务端 HMAC principal，浏览器不会接收密钥。页面按当前账号 capability 显示操作入口，写操作均要求明确确认且不会自动重试。

官方能力依据：CloudBase 官方支持用 [HTTP 访问服务把 HTTPS 路由映射到云函数](https://docs.cloudbase.net/service/access-cloud-function)。

## 边界

Web 工程不复制会员、活动、订单或权限规则。真实请求沿用 `AdminRequest v1`，CloudBase adapter 回到同一个 `AdminApplication.execute` seam；BFF 只处理浏览器会话、来源验证和 server-to-server transport。


## CloudBase 部署

后台运行在 CloudBase：前端静态托管（隔离前缀），BFF 云函数，认证存储为独立 MySQL schema，业务由对应的 admin API（生产 `mip-admin-api`，测试 `mip-t-admin-api`）鉴权。发布、回滚与自定义域名见 [CloudBase 运行说明](cloudbase/README.md)；生产与测试的认证数据完全隔离，不实时同步。
