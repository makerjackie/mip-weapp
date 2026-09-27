# CloudBase 管理后台运行入口

`index.ts` 将平台 HTTP gateway event 转成标准 `Request`，复用已有 BFF。MySQL 适配器只替换认证存储；管理操作仍由 `mip-admin-api` 执行和鉴权。

```bash
pnpm --dir admin-web build
node --test admin-web/cloudbase/*.test.mjs
node admin-web/scripts/build-cloudbase.mjs
```

产物固定在 `.tmp/admin-cloudbase-function/`，包含 `index.js`、无外部依赖的 `package.json` 和可选 `public/` 静态文件。Nodejs20.19，入口 `index.main`。依赖打包，不需要在云端安装。构建只读取源码和 `admin-web/dist/`，不读取本地环境文件或注入服务端密钥。

部署配置：

- `MIP_ADMIN_AUTH_MYSQL_URI`：认证表专用运行时连接串；配置 VPC 与最小权限。
- 现有 BFF 的 `MIP_ADMIN_UPSTREAM_URL`、`MIP_ADMIN_UPSTREAM_HMAC_SECRET`、`MIP_ADMIN_WEB_LOGIN_HMAC_SECRET`、`MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET`、`MIP_WEB_ALLOWED_APP_IDS`、`MIP_WEB_LOGIN_MINIPROGRAM_APP_ID`、`MIP_WEB_SESSION_SECRET`。
- `MIP_WEB_ALLOWED_ORIGIN`：本次部署唯一 HTTPS origin，不带路径、查询或 hash。
- 函数不配置定时器，必须关闭客户端 SDK 调用权限。登录限流优先读取平台每次调用注入的 `context.environment` JSON 中的 `TCB_SOURCE_IP` / `WX_CLIENTIP` / `WX_CLIENTIPV6`（兼容旧 `context.environ`），再读取 HTTP 网关构造的 `requestContext.sourceIp` / `requestContext.identity.sourceIp` 或平台 `context.clientIP` / `context.sourceIp`；所有候选均校验 IP 格式，不信任客户端 IP headers，也不读取可能残留上次身份的 `process.env` / `getWXContext()`。解析格式遵循 [CloudBase 官方 Node SDK parseContext](https://github.com/TencentCloudBase/node-sdk/blob/master/src/cloudbase.ts)。未提供可信 IP 时使用 BFF 原有共享 unknown bucket，需在发布验收中确认正常网关不会落入此兜底。

使用默认 `app.tcloudbase.com` HTTP 网关：`/api` 路由到该函数，`/` 路由到 CloudBase 静态托管，并设置 `PathRewrite.StaticStorePrefix=/mip-admin-console`。前端资产只上传到既有托管的 `mip-admin-console/` 隔离前缀，不覆盖共享托管根目录。为临时同源验收，可将 `/` 指向该函数，用打包内的 `public/` 返回同一份前端产物；不依赖 Cloudflare。事件函数不适合长期高流量静态资源托管。

部署后必须实测单 Cookie 兼容模式下的会话凭证到达浏览器、登录/退出/改密码、可信 IP 限流、源站 origin 防护、真实业务接口与静态资源 MIME；本地协议测试不能代替网关验收。正式域名切换与 Cloudflare 下线单独执行，保留旧平台直至用户确认。

平台 event 协议参考：https://docs.cloudbase.net/service/access-cloud-function

## 发布顺序与回滚

以下命令从仓库根目录执行。占位符必须替换为目标环境或真实 HTTPS origin；生产阶段还须为写入命令追加 `--confirm-production`。环境级 API Key 与服务端密钥从本地忽略文件读取，不写入命令行、静态包或提交记录。控制面确需本机 Device Flow 时按根 AGENTS.md 显式选择 `CLOUDBASE_AUTH_MODE=local`。

1. 配置 `MIP_DEPLOYMENT_STAGE`、环境 ID 与认证服务密钥，执行 `pnpm cloud:status`。初始化独立认证 schema，先查看计划，再应用：

   ```bash
   node scripts/setup-admin-cloudbase-auth.mjs --confirm-env=<ENV_ID> --confirm-schema=mip_admin_auth
   node scripts/setup-admin-cloudbase-auth.mjs --confirm-env=<ENV_ID> --confirm-schema=mip_admin_auth --apply
   ```

2. 迁移本地已配置管理员。脚本先通过旧后台真实登录和服务端身份核验，再创建同一身份的认证记录；不复制旧会话、不新增业务权限。其他管理员需单独经过绑定核验，不能仅凭任意手机号授予管理员资格。

   ```bash
   node scripts/migrate-admin-cloudbase-account.mjs --confirm-env=<ENV_ID> --confirm-account=configured-administrator
   ```

3. 执行 `pnpm verify:all`，构建真实模式前端，上传到既有静态托管的隔离前缀。部署脚本仅快照 `admin-web/dist/`，使用 `manageHosting upload` 直接上传，无云端安装和构建，拒绝链接和密钥文件，并跳过正常构建生成的 source map；上传后下载该前缀，逐文件核对大小和 SHA-256，全部匹配才报完成。不会上传仓库或环境文件、删除旧资产、修改共享根目录或改变 Cloudflare。

   ```bash
   VITE_MIP_ADMIN_DEMO_MODE=false pnpm admin:web:build
   node scripts/deploy-admin-cloudbase-static.mjs --confirm-env=<ENV_ID> --confirm-prefix=mip-admin-console/
   ```

4. 使用目标环境默认 `app.tcloudbase.com` HTTPS origin，设置本地 `MIP_ADMIN_WEB_CLOUDBASE_ORIGIN`。打包并部署 BFF：同源 `/api` 配置到函数，`/` 配置为 `STATIC_STORE`，用 `PathRewrite.StaticStorePrefix=/mip-admin-console` 读取隔离前缀；其余网关路由保持不变。不要使用 `manageApps` 自动分配的 `webapps.tcloudbase.com` 系统内部域名作为后台入口，该域名禁止手动添加 `/api` 路由，无法直接满足现有同源 BFF 架构。

   ```bash
   node admin-web/scripts/build-cloudbase.mjs
   node scripts/deploy-admin-cloudbase.mjs --confirm-env=<ENV_ID> --confirm-function=mip-admin-web-api
   ```

5. 微信确认登录并行期间使用独立 challenge 命名空间：CloudBase 的六位码为 `9xxxxx`，token 为 `z_` 前缀；旧后台生成器排除这两个范围。业务函数通过 `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 将新命名空间回调送到新 BFF，旧确认地址继续服务旧后台。必须先发布旧后台的保留范围，再等待至少 **5 分钟**，让旧版已签发 challenge 到期，最后启用分流。否则旧码恰好落入新范围会被送错目的地。此等待不清除账户、密码或业务数据。只切换静态网站无法替代登录回调配置。

6. 执行真实 HTTPS 验证，再进行浏览器桌面/手机视口及业务写操作验收：

   ```bash
   node scripts/verify-admin-cloudbase.mjs --origin=<EXACT_HTTPS_ORIGIN>
   ```

   脚本使用本地已配置测试账号，检查登录、会话、退出、来源限制及审查过的只读业务操作；不代表所有新增/编辑/上传/支付业务写入均已通过。静态资源上传和回读成功也不代表 BFF、Cookie、权限或业务验收通过。

静态发布证据保存在 `.tmp/admin-cloudbase-static/`；函数目标记录在 `.tmp/admin-cloudbase-deploy/target.private.json`，均不提交。保留 Cloudflare Pages、D1、旧域名及登录确认路由，用户确认前不删除、不关停。回滚先恢复可用的旧后台入口，并保证旧 challenge 回调仍可达；不要把新旧认证数据库当作实时同步。用户确认后再安排正式域名切换、过期 challenge 排空和旧服务下线。

## 本轮已知限制

共享静态托管目前启用了 SPA fallback，不存在的 `/assets/...` 路径会返回首页 HTML 和 HTTP 200，而非 404。本应用使用 hash 路由，不需要该 fallback，但本次不改共享环境的网站全局配置。`verify-admin-cloudbase.mjs` 保留严格 404 检查并报告失败；真实 JS/CSS 的 MIME、部署文件 SHA-256 回读及浏览器加载须另行通过，不将缺失文件误报为成功。未来切正式域名前可评估独立静态托管配置。

### 事件网关的 Cookie 限制

实测本环境网关会把多个 `Set-Cookie` 合并成最后一条，不能仅靠本地 `multiValueHeaders` 单测判断成功。CloudBase runtime 启用单 Cookie 响应：微信确认交换只下发会话 Cookie，退出只清除会话 Cookie。已消费的 challenge 由服务端拒绝重用，浏览器残留的挑战 Cookie 最多五分钟自然过期，不承载运营权限。Cloudflare 保留原多 Cookie 行为。部署后必须验证“创建挑战 → 受信确认 → HTTP 交换收到 session Cookie → 查询运营会话 → 退出后旧会话被拒绝”。
