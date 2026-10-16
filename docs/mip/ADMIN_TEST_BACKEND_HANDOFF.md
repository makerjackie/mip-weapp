# 测试环境管理后台部署交接（MIW-111）

写作目的：把两套环境的现状与边界讲清楚，供接手同事部署测试环境管理后台（`test.admin.mip.cool`）前建立完整认知。本文不锁定具体操作手法——仓库已有经过多轮验证的发布 runbook（见 §7 索引）；接手人按 runbook 流程 + 本文 §5 的目标对象清单执行即可。

权威关系：环境方向以 [ENVIRONMENTS.md](ENVIRONMENTS.md) 为准，动态状态以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 为准。本文是 2026-10-16 的交接快照，不复制会变化的数量（文中数字均标注截至日期）。

## 1. 两套环境总览

关键前提：**只有同一个 CloudBase 环境**。第二个 CloudBase 环境需要第二份包年费用，2026-10-15 拍板排除，改为「同环境、同实例、多库、两套函数」的隔离方案。所以生产与测试不是两朵云，而是同一环境内两套靠命名和数据隔离的资源。

| 维度 | 生产 | 测试 |
| --- | --- | --- |
| CloudBase 环境 | 唯一 EnvID（本机 `envs/prod/.env.local`） | **同一个** EnvID |
| MySQL | 同实例默认库 | 同实例第二库 `mip_test` |
| 云函数名 | `mip-*-api` 默认名（已烘焙，不可变更） | `mip-t-*` 全套显式覆盖 |
| 小程序 | 正式版（构建自 `envs/prod`） | 开发/体验版（构建自 `envs/test`，烘焙 `mip-t-*`） |
| stage / catalog / payment | `production` / `LIVE` / 验收后 `live` | `staging` / `TEST` / `disabled`（无支付商户，管理端免费补录） |
| 管理后台 | 已部署（§4） | **待部署（本文主题）** |

选边开关是本机配置目录：`envs/prod/` 与 `envs/test/`（均 gitignore，各含 `.env.local` 与 `.env.secrets.local`；`env.example` 是字段模板）。根 `.env.local` 当前默认 `MIP_ENV_DIR=envs/test`——日常 `pnpm build` 即测试包；正式发布唯一出口 `pnpm release:prod`。**不存在「连到哪个环境」的运行时开关，函数名在构建时烘焙进产物。**

## 2. 两套数据库

同一 MySQL 实例上的两个 schema，靠账号权限隔离，不靠网络隔离：

- **生产库**（实例默认 schema）：全部真实业务表。正式发布前需按 ENVIRONMENTS.md 完成一次数据清洗（下架演示种子、清理测试期数据）。
- **测试库 `mip_test`**：2026-10-15 建成，全量迁移已应用（截至当日 115 个迁移 / 154 表，最新数字以 PROJECT_STATUS 为准）。测试库只执行迁移与正式配置导入；允许演示 seed（`seed:demo --confirm-staging-demo`）。不做常态化的生产→测试数据复制（手机号/UnionID 加密 pepper 按目标派生，复制的生产身份字段在测试环境不可解密）。
- **runtime 账号**：按 (EnvID, schema) 各自派生两个账号，各自只授本库 `mip_*` 表级权限；跨库隔离由部署链的表级授权断言校验。连接 URI 分别落盘 `envs/prod/.env.secrets.local` 与 `envs/test/.env.secrets.local`，不入 Git。
- **后台认证库是第三类 schema**：生产后台的密码/会话/登录限流不在业务库里，使用独立 `mip_admin_auth` schema + 专用最小权限账号（`mipauth_*` 前缀）。测试后台需要**新建同构的测试认证 schema 与独立派生账号**（建议 `mip_test_admin_auth`），不与生产认证库共用任何表、账号或密钥值；新旧认证库不实时同步。
- 备份：`scripts/backup-cloudbase-mysql.mjs` 已支持 `MIP_DB_SCHEMA`，两库分别备份；迁移链有 pre-apply 备份门禁。

## 3. 两套云函数

- 生产 `mip-*` 与测试 `mip-t-*` 各自独立部署、独立配置，互不调用对方。
- 测试函数集规划 21 个函数名（`envs/test/.env.local` 显式列全，不依赖 defaults 兜底）；截至 2026-10-15 已有 16 个核心函数上线并过 `cloud:verify`（schema、最小权限授权、函数健康、受保护调用规则全绿）。支付三函数与两个调度器未建——测试支付 `disabled`，需要支付链路时再按 ENVIRONMENTS.md 三选一方案建。
- 客户端选边靠**构建时烘焙**：小程序产物内的函数名常量来自构建所用 env 目录。后台（本文主题）选边靠 **BFF 的 `MIP_ADMIN_UPSTREAM_URL`** 指向哪个 admin-api——前端产物不感知函数名，生产/测试共用同一套 admin-web 代码构建。

## 4. 管理后台现状

### 生产后台：已在腾讯云 CloudBase（2026-10-09 起）

| 组件 | 事实 |
| --- | --- |
| 前端静态 | CloudBase 静态托管隔离前缀 `mip-admin-console/` |
| BFF | 云函数 `mip-admin-web-api`（Nodejs20.19，入口 `index.main`，同源服务 `/api` 与 `/assets`） |
| 认证存储 | MySQL 独立 `mip_admin_auth` schema + 专用账号 |
| 业务上游 | BFF 经 HMAC envelope 调 `mip-admin-api`（`MIP_ADMIN_UPSTREAM_URL`） |
| 入口 | 默认 `app.tcloudbase.com` 网关域 + `admin.mip.cool`（DIRECT 绑定网关；`/`、`/api`、`/assets` 三条路由） |

Cloudflare 仅剩残留角色：临时别名 `mipadmin.01mvp.com` 的 302 跳转与旧站本体，保留至确认下线；CloudBase 直连的页面与 API 不经过 Cloudflare。

### 测试后台：未部署，当前唯一后台遗留项

2026-10-16 拍板：测试后台走 **CloudBase 同构路线**（与生产同架构、不同命名与密钥），替代 2026-10-15 记录的「新 Cloudflare Pages 项目 + 新 D1」方案；`admin-web/wrangler.test.example.toml` 不再用于本路线。

服务端侧的登录链路配置已就位：`envs/test` 的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` 已显式指向 `https://test.admin.mip.cool/api/internal/auth/challenge/confirm`（云函数部署脚本默认值只对生产正确，这里是显式覆盖）。

## 5. 测试后台目标对象清单（部署范围）

与生产逐一对应。命名是建议值，实施中如有调整，回写本表并同步 ENVIRONMENTS.md：

| 对象 | 生产现状 | 测试目标 |
| --- | --- | --- |
| 入口域名 | `admin.mip.cool`（DIRECT 绑网关） | `test.admin.mip.cool`（DIRECT 绑同一网关；DNS 与证书按 custom-domain 流程首次配置。多级子域名：`admin.mip.cool` 的证书不覆盖它，需为该域名单独签发） |
| 网关路由 | 默认域与 admin.mip.cool：`/`→STATIC_STORE（`StaticStorePrefix=/mip-admin-console`），`/api`、`/assets`→`mip-admin-web-api` | **仅在 admin-test 域名上**配同构三条路由：`/`→测试静态前缀；`/api`、`/assets`→测试 BFF。不得改动默认网关域和 admin.mip.cool 上的任何生产路由 |
| 静态前缀 | `mip-admin-console/` | `mip-admin-console-test/`（独立隔离前缀） |
| BFF 函数 | `mip-admin-web-api` | `mip-t-admin-web-api`（进测试函数命名集） |
| 认证 schema | `mip_admin_auth` + 专用账号 | `mip_test_admin_auth` + 独立派生账号 |
| 业务上游 | `mip-admin-api` | `mip-t-admin-api`（已上线） |
| 密钥 | 一套 | **全新一套**：会话密封、登录确认 HMAC、小程序码 HMAC、BFF↔admin-api HMAC（`MIP_ADMIN_WEB_BFF_HMAC_SECRET` 与 BFF 侧 `MIP_ADMIN_UPSTREAM_HMAC_SECRET` 同值异名）、认证库密码 |
| Origin 白名单 | 生产域名 | `MIP_WEB_ALLOWED_ORIGIN=https://test.admin.mip.cool` |

登录链路（部署完成后闭环）：测试小程序（烘焙 `mip-t-*`）请求 `mip-t-admin-api` → 测试 BFF 签发六位码 → 运营在 admin-test 输入确认 → 云函数按 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` 回调测试域名完成交换。测试后台的 challenge、会话、密码全部落测试认证 schema，与生产完全隔离；测试后台的登录与授权不能作为生产授权。

## 6. 接手前必读的约束与已知事实

1. **部署脚本当前硬编码生产命名，直接换参数会失败**，需先做一次受控参数化（或新建测试变体），且不得削弱任何安全守卫：
   - `scripts/deploy-admin-cloudbase.mjs`：函数名 `mip-admin-web-api` 硬编码；上游 env 读自已存在的 `mip-admin-api`（认证库 URI 也从它的 `MIP_DB_CONNECTION_URI` 派生）；断言 `MIP_ADMIN_AUTH_SCHEMA_OWNER=<env>:mip_admin_auth:<user>`；**只允许默认网关 origin**（显式拒绝自定义 origin）。测试化需覆盖：目标函数名、上游函数、schema 所有权标记、目标 origin 与域名路由。
   - `scripts/deploy-admin-cloudbase-static.mjs`：前缀 `mip-admin-console/` 硬编码断言。
   - `scripts/setup-admin-cloudbase-auth.mjs`：`--confirm-schema=mip_admin_auth` 硬编码断言。
   - 必须保留的守卫：静态上传隔离前缀回读、拒绝越界/删除历史文件、函数 Active+配置+代码包摘要回读、拒绝覆盖生产路由。
2. **HTTPS 验收脚本** `scripts/verify-admin-cloudbase.mjs` 要求 `--origin` 与已部署 target 完全一致，且本机需配置 `MIP_ADMIN_TEST_PHONE` / `MIP_ADMIN_TEST_PASSWORD`。生产后台历轮验收因缺这两个值记 BLOCKED——测试后台验收前先把测试账号配置进本机忽略 env，不要复用这个缺口。
3. **密钥纪律**：全部密钥值全新生成，任何值不复用生产；不写命令行、不入 Git、不入文档；`envs/test/.env.secrets.local` 权限 0600。
4. **生产保护红线**：静态上传只进测试前缀；网关改动只落 admin-test 域名；不触碰 `mip-admin-console/`、`mip-admin-web-api`、`mip_admin_auth`、admin.mip.cool 路由、Cloudflare 残留入口。
5. **验收口径**：发布快照过 `pnpm verify:all`（前端 `VITE_MIP_ADMIN_DEMO_MODE=false`）；三层证据（函数/配置回读、真实 HTTPS、浏览器桌面+手机视口）按 runbook 留证；微信确认登录与扫码需真机单独记录；失败项如实记 BLOCKED，不以单项成功替代整链验收。
6. **证书**：admin.mip.cool 用腾讯云免费证书（生产已有独立自动续期任务，日常发布不覆盖它）。测试域名的证书与续期按 custom-domain 与 renewal 流程处理；注意证书预检 PASS 不等于已签发。
7. **域名草名变更**：2026-10-16 交接时域名由草名 `admin-test.mip.cool` 定为 `test.admin.mip.cool`。早前快照（2026-10-15 的状态记录、`admin-web/README.md` 历史章节、`admin-web/wrangler.test.example.toml` 注释）仍会出现旧草名，以本文 §5 为准。已上线的测试函数 env 若烘焙了旧 confirm URL，随测试后台部署一并按既有 config-update 守卫更新（以目标函数 env 回读为准，不凭文档假定）。

## 7. 权威文档索引

- 环境方向与拍板记录：[ENVIRONMENTS.md](ENVIRONMENTS.md)
- CloudBase 后台运行说明（构建、发布顺序、回滚）：[admin-web/cloudbase/README.md](../../admin-web/cloudbase/README.md)
- 发布三层证据与流程：`.agents/skills/mip-admin-release/SKILL.md`（含 `references/custom-domain.md`、`references/certificate-renewal.md`、`references/login-verification.md`）
- 云资源边界：[CLOUDBASE.md](../CLOUDBASE.md)
- 动态状态与遗留项：[PROJECT_STATUS.md](PROJECT_STATUS.md)
- 发布证据样例：[evidence/admin-release-20261009](evidence/admin-release-20261009/README.md)（其中原生健康探针为 BLOCKED 的如实记录，不是「全绿样板」）
