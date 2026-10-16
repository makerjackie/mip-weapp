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
- `MIP_WEB_ALLOWED_ORIGIN`：默认 HTTPS origin，不带路径、查询或 hash。临时域名并行访问时，使用 `MIP_WEB_ADDITIONAL_ORIGINS` 配置以逗号分隔的精确 origin 白名单；不支持通配符，Cookie 仍按访问域名隔离。
- 函数不配置定时器，必须关闭客户端 SDK 调用权限。登录限流优先读取平台每次调用注入的 `context.environment` JSON 中的 `TCB_SOURCE_IP` / `WX_CLIENTIP` / `WX_CLIENTIPV6`（兼容旧 `context.environ`），再读取 HTTP 网关构造的 `requestContext.sourceIp` / `requestContext.identity.sourceIp` 或平台 `context.clientIP` / `context.sourceIp`；所有候选均校验 IP 格式，不信任客户端 IP headers，也不读取可能残留上次身份的 `process.env` / `getWXContext()`。解析格式遵循 [CloudBase 官方 Node SDK parseContext](https://github.com/TencentCloudBase/node-sdk/blob/master/src/cloudbase.ts)。未提供可信 IP 时使用 BFF 原有共享 unknown bucket，需在发布验收中确认正常网关不会落入此兜底。

使用默认 `app.tcloudbase.com` HTTP 网关：`/api` 路由到该函数，所属 `/assets` 路由到同一函数的严格资源处理器，`/` 路由到 CloudBase 静态托管，并设置 `PathRewrite.StaticStorePrefix=/mip-admin-console`。前端资产只上传到既有托管的 `mip-admin-console/` 隔离前缀，不覆盖共享托管根目录。为临时同源验收，可将 `/` 指向该函数，用打包内的 `public/` 返回同一份前端产物。事件函数不适合长期高流量静态资源托管。

部署后必须实测单 Cookie 兼容模式下的会话凭证到达浏览器、登录/退出/改密码、可信 IP 限流、源站 origin 防护、真实业务接口与静态资源 MIME；本地协议测试不能代替网关验收。域名与证书维护按发布 skill 的对应 reference 执行。

平台 event 协议参考：https://docs.cloudbase.net/service/access-cloud-function

## 发布顺序与回滚

完整流程以 [mip-admin-release skill](../../.agents/skills/mip-admin-release/SKILL.md) 为准。以下命令从仓库根目录执行，先选择 `MIP_ENV_DIR` 并核对 [正式/测试目标表](../../.agents/skills/mip-admin-release/references/custom-domain.md#dns-归属与目标选择)。命令占位符必须替换为所选目标；生产写入追加 `--confirm-production`。控制面需要本机 Device Flow 时按根 AGENTS.md 选择已授权的 `CLOUDBASE_AUTH_MODE=local`。

1. 设置已核实的目标配置目录，执行 `pnpm cloud:status`。首次初始化认证 schema 时先查看计划，再应用；日常更新不重复建库或迁移账号。新管理员通过小程序确认登录后本人设置密码。

   ```bash
   export MIP_ENV_DIR=<已核实的目标配置目录>
   node scripts/setup-admin-cloudbase-auth.mjs --confirm-env=<ENV_ID> --confirm-schema=<目标认证schema>
   node scripts/setup-admin-cloudbase-auth.mjs --confirm-env=<ENV_ID> --confirm-schema=<目标认证schema> --apply
   ```

2. 保存目标 BFF 的完整配置、路由和校验后的旧 ZIP。发布快照通过 `pnpm verify:all`，以 `VITE_MIP_ADMIN_DEMO_MODE=false` 构建前端并打包 BFF。将上一版 `public/assets` 中新包缺少的不可变哈希资源保留到新包；同路径字节不同立即停止，不替换新 HTML 或服务端代码。

   ```bash
   VITE_MIP_ADMIN_DEMO_MODE=false pnpm admin:web:build
   node admin-web/scripts/build-cloudbase.mjs
   ```

3. 有业务函数变更时先发布明确受影响且与旧前端兼容的函数；随后**先部署兼容 BFF，再上传新静态入口**。只上传静态入口会让新 HTML 引用 BFF 中不存在的哈希 JS，造成白屏。

   ```bash
   node scripts/deploy-admin-cloudbase.mjs --confirm-env=<ENV_ID> --confirm-function=<目标BFF>
   node scripts/deploy-admin-cloudbase-static.mjs --confirm-env=<ENV_ID> --confirm-prefix=<目标静态前缀>/
   ```

   `MIP_ADMIN_WEB_CLOUDBASE_ORIGIN` 是所选后台完整 HTTPS origin，不能使用 `webapps.tcloudbase.com` 系统内部域名。部署脚本核对函数、schema 所有权、网关与静态前缀；`/api`、`/assets` 指向目标 BFF，`/` 指向目标静态前缀，保留其余站点。静态脚本直接上传构建快照并回读大小和 SHA-256，不上传环境文件，不删除历史文件或修改共享托管根。

4. 核对目标 admin-api 的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` **和** `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL`。`MIGRATION_URL` 是保留的兼容字段名，`9xxxxx` / `z_` 仍走这条回调；两条 URL 都应对应所选目标 BFF。正式与测试 HMAC 各自配对，不跨环境复用。配置回读不能代替真实微信确认。

5. 核对最终函数 ZIP、配置、真实域名的逐文件静态清单，再用已配置的目标测试账号验证 HTTPS 登录/会话/退出、来源限制与只读业务。最后实际浏览器验证桌面、手机视口和受影响功能。

   ```bash
   node scripts/verify-admin-live-assets.mjs --origin=<目标HTTPS-origin> --manifest=.tmp/admin-cloudbase-static/verified.private.json --output=.tmp/<本轮发布目录>/assets.public.json
   node --experimental-strip-types scripts/verify-admin-cloudbase.mjs --origin=<相同origin>
   ```

   发布清单、私有 target、凭证与原始回读留在忽略的 `.tmp/` 或本机配置目录；只提交脱敏证据。脚本不代表全部新增、编辑、上传、支付或真机链路已验收。

回滚恢复同一目标已校验且互相匹配的 BFF 与静态产物，保留认证 schema、密钥、有效回调和业务新写入；不假设正式与测试的账号/会话同步。非兼容业务变更先设计协调发布与回滚下限，不能直接套普通静态更新顺序。

## 本轮已知限制

共享静态托管的 SPA fallback 曾使缺失 `/assets/...` 返回首页 HTML/200。2026-09-29 已为此应用所属 `/assets` 增加 BFF 严格处理，真实 HTTPS 缺失 JS 返回 404，资源 MIME 检查通过；共享静态托管全局配置没有修改。部署脚本核对路由所有权并保护其他站点。该事件函数承载静态资源仍需观察高流量成本与性能；未来正式域名可评估独立静态托管配置。

### 事件网关的 Cookie 限制

实测本环境网关会把多个 `Set-Cookie` 合并成最后一条，不能仅靠本地 `multiValueHeaders` 单测判断成功。CloudBase runtime 启用单 Cookie 响应：微信确认交换只下发会话 Cookie，退出只清除会话 Cookie。已消费的 challenge 由服务端拒绝重用，浏览器残留的挑战 Cookie 最多五分钟自然过期，不承载运营权限。部署后必须验证“创建挑战 → 受信确认 → HTTP 交换收到 session Cookie → 查询运营会话 → 退出后旧会话被拒绝”。

### 首次密码登录等待

密码登录单次等待上限为 30 秒。只有明确的 502/503/504 临时服务失败会在 2 秒、5 秒后各重试一次（最多三次请求），页面持续显示等待提示，关闭登录窗口后不再发起重试。错误密码、限流、配置错误、网络结果不明与修改密码不自动重放；耗尽后保留手动重试入口。这是临时故障容错，不代表已证实某次错误由冷启动引起，也不增加保活定时器。
