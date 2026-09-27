# 测试与生产环境方案

本页记录环境隔离方案及落地前提，不表示资源已创建或部署已完成。核对日期：2026-09-27。实际发布和目标环境的当前状态以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 及目标回读证据为准。

## 当前状态

- 本机配置为单目标 `MIP_DEPLOYMENT_STAGE=staging`、`MIP_CATALOG_STAGE=TEST`、`MIP_PAYMENT_MODE=test`。
- 本轮尚未创建第二套 CloudBase、数据库或管理后台环境。
- 小程序从构建配置注入固定 CloudBase EnvID，没有应用内环境切换开关，也没有按 `develop`、`trial`、`release` 自动选择环境的逻辑。
- 当前管理后台发布命令固定指向 `mip-admin-web`，Wrangler 配置只有一套 D1 绑定。
- `miptest.01mvp.com` 是静态验收报告站，不能视为第二套可操作管理后台。
- 本轮取消体验版上传；环境规划和后台验收不构成上传、正式发布或新建资源的完成证据。

## 隔离方案选择

两个独立 CloudBase 环境不是技术上的必要条件。CloudBase 托管 MySQL 支持同实例的多个逻辑数据库（schema）；可以在同一环境内分别承载测试和生产数据。独立 CloudBase 环境则提供更强的资源与运维边界。

| 方案 | 隔离范围 | 适用场景 |
| --- | --- | --- |
| 同 CloudBase 环境、两个 MySQL schema | 数据、runtime 账号、应用函数与配置分别隔离；计算资源和环境管理凭据仍共享 | 作为控制资源成本的过渡方案，需先完成下述工程改造 |
| 两个独立 CloudBase 环境 | 数据、云函数、存储、资源容量和环境凭据分别隔离 | 正式运营更重视测试误操作、资源争用和故障隔离时采用 |

同环境方案不等于零成本，也不保证总费用一定更低；实际费用取决于共享实例用量。无论选择哪一种，都不能只改 `MIP_DEPLOYMENT_STAGE` 或数据库 URI，却复用同一套函数配置。

### 当前核对依据与限制

2026-09-27 已通过仓库 `config/mcporter.json` 包装器执行只读检查：数据库列表返回一个现有业务库及系统库；当前管理连接具有建库所需的 CREATE 能力，业务 runtime 则仅持有现有业务库的精确表级权限。没有执行建库、修改权限或写入第二库，故不把只读结果当成第二库已经创建或端到端验证成功。

官方 [CloudBase MySQL 管理 SDK](https://docs.cloudbase.net/api-reference/manager/node/mysql) 提供 `describeClusterDatabases`、按 `Db` 查询表和授权，以及 SQL 执行入口；当前 MCP 的查询和 DDL 接口支持 `dbInstance.schema`。这些是 CloudBase 托管 MySQL 的能力，不能用普通腾讯云 MySQL 或微搭私有部署的文档替代。第二库的实际创建、连接、迁移和权限拒绝测试仍应在分库实施阶段核对目标后完成。

### 两种方案共同的配置边界

| 项目 | 测试环境 | 生产环境 |
| --- | --- | --- |
| stage | 当前保留 `staging` | `production` |
| catalog | `TEST` | 正式目录 `LIVE` |
| payment | `test` 或 `disabled` | 默认 `disabled`，正式支付独立验收后才启用 `live` |
| 演示数据 | 满足 staging 确认条件时允许 | 禁止 demo seed 和 QA 夹具 |
| 管理后台 | 独立 Pages 项目、域名、D1、会话密钥和 HMAC | 另一套独立资源与密钥 |
| 小程序连接 | 构建时固定测试目标 | 构建时固定生产目标 |

生产初始化只执行经过验证的迁移和正式配置导入，不复制 demo 用户、合成签到、测试订单或测试权益。若未来需要迁移真实数据，应另行按 [DEPLOYMENT.md](../DEPLOYMENT.md) 和 [IDENTITY_MIGRATION.md](../IDENTITY_MIGRATION.md) 备份、校验和执行。

### 同环境分库需先完成的工程改造

当前代码还不能仅靠修改 URI 安全运行同环境双 schema。具体入口如下：

- 云部署脚本（`scripts/deploy-functions.mjs`）：`targetSchema` 从 CloudBase 默认实例信息读取，并拒绝 URI 中不同的 schema。需要增加显式的部署目标库及其核对，保留环境、stage、生产确认门禁，不能简单删除校验。
- runtime 账号派生（`scripts/lib/mysql-privilege-assert.mjs`）与 project:init（`scripts/project-init.mjs`）：当前 `runtimeUserForEnvironment` 只使用 EnvID，同环境会得到同一账号。需要分别派生测试/生产账号，精确授予各自库内的业务表权限，验证不能跨库读写。
- 表级授权收敛（`scripts/converge-mip-runtime-grants.mjs`）：当前校验环境派生账号；需一并接受已确认的库和账号组合，不授予跨库、schema ALL 或全局权限。
- 迁移执行器（`scripts/apply-mip-schema.mjs`）：当前 SQL 调用不传 `dbInstance.schema`，依赖默认库。迁移、备份、seed、owner bootstrap 及云端验收都需要贯穿同一显式库目标和回读核对；建库属于独立基础设施步骤，不塞进只允许 `mip_*` 表的业务迁移。
- 函数名配置（`scripts/lib/mip-function-names.mjs`）：已支持独立函数名，但还需分别配置测试/生产整套函数及内部调用、支付回调和调度目标；不能轮流更新同名函数的数据库 URI。
- 媒体继续使用带 stage 的独立对象前缀，各套函数只写自己的前缀。后台 BFF、D1 会话、域名、服务端 HMAC/加密/会话密钥及构建目标也要分别配置，不能因为共享 CloudBase EnvID 而合并。

同一实例仍共享 CPU、连接容量和生命周期，环境级管理凭据也不是两个 schema 间的安全边界。测试压测、实例维护和误用管理凭据仍可能影响生产。应用运行账号的隔离不能替代这些限制。

### 构建与配置隔离

第一阶段使用两个独立工作目录，从同一个已验证提交构建。每个目录分别保存被 Git 忽略的 `.env.local` 与 `.env.secrets.local`，并使用各自的构建产物和开发者工具项目。生产凭证不得复制进测试目录，也不得进入小程序包、验收网站或 Git。

现有加载器并不支持仅新增 `.env.production` 就自动切换：

- 云脚本读取 `.env.secrets.local`、`.env.local`，再叠加进程环境；本地两个文件中的非空冲突会报错，但 shell 变量仍可能覆盖文件值。
- 小程序构建读取 `.env.local`，再叠加进程环境；CloudBase EnvID、函数名、目录和支付模式成为构建常量；schema 与连接凭据只留在服务端。
- 操作前必须核对最终解析的目标配置，不能只看目录名或体验版标签。使用干净进程环境，避免继承上一套环境的变量。

同一 AppID 的测试包与生产包必须分别构建和验证；“体验版”本身不保证连接测试环境。每次上传仍须通过完整 `pnpm verify:all`，并按已授权的上传与发布范围执行。后续若增加统一环境选择入口，应一次性选择完整配置并验证 EnvID、schema、stage、函数名、目录、支付、runtime 用户及后台回调的一致性；目前尚未实现该入口。

### 管理后台隔离

两套后台的 `MIP_ADMIN_UPSTREAM_URL` 分别指向各自的 `mip-admin-api`。各自配置精确的 `MIP_WEB_ALLOWED_ORIGIN`、独立 D1 登录状态和会话密钥；查询、登录确认及小程序码 HMAC 在同一环境两端对应，但不跨环境复用。

云函数的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` 必须显式指向对应后台。现有部署脚本默认使用当前后台域名，创建第二后台时不能直接沿用默认值。现有 `deploy:pages` 项目名和 Wrangler D1 绑定也必须先拆分配置，不能直接执行旧命令并认为已发布到第二环境。

后台登录、角色授权和撤销分别验收，测试后台的登录状态不能作为生产授权。配置细节见 [admin-web/README.md](../../admin-web/README.md)。

## 同一微信成为两套应用的管理员

这里指 MIP 应用的 `PLATFORM_OWNER`，不是微信公众平台管理员，也不是腾讯云资源管理员。

每套部署目标都独立完成以下步骤。下列现有命令适用于独立 CloudBase 环境；同环境双 schema 必须先补齐上文的目标库传递，不能直接照抄并假定已选择第二库：

1. 用户通过连接该环境的小程序真实登录，完成手机号授权、昵称、主分会及当前协议。即使微信账号相同，另一环境仍需建立自己的可信身份和资料记录；不复制 OpenID 绑定，也不把 demo 账号提升为管理员。
2. 维护者在该工作目录的本地配置中设置 `MIP_OWNER_PHONE`，使用该环境自己的手机号加密密钥和 AppID 配置。
3. 先验证目标凭证，再执行现有引导命令。下列尖括号均为占位值，不应将真实标识写进文档：

```bash
pnpm cloud:status
pnpm admin:bootstrap -- --confirm-env=<该环境的精确EnvID> --confirm-owner
```

4. 脚本通过当前 AppID 范围的手机号哈希定位唯一 ACTIVE、非 demo 用户，复核资料与协议，授予平台 owner，然后读回角色并写审计。候选缺失或不唯一时停止，不改用伪造身份或跳过资格检查。
5. 用户打开对应环境后台，在该环境小程序的“现场工作台 → 确认网页登录”中输入六位登录码并确认；最后检查操作权限及审计。

现有 owner 脚本要求精确 EnvID 和 `--confirm-owner`，尚无单独的 `--confirm-production` 参数。生产引导需在明确授权、核对目标后执行；不要虚构一个当前脚本不会检查的确认参数。生产云函数部署则已有 stage 检查和 `--confirm-production` 门禁，详见部署手册。

## 实现入口

- 云配置加载器（`scripts/lib/example-cloudbase.mjs`）
- [小程序构建配置](../../weapp-vite.config.ts) 与 [运行配置](../../src/config/runtime.ts)
- 云函数部署脚本（`scripts/deploy-functions.mjs`）
- owner 引导脚本（`scripts/bootstrap-owner.mjs`） 与 资格/授权查询（`scripts/lib/mip-owner-bootstrap.mjs`）
- [后台发布命令](../../admin-web/package.json) 与 [Wrangler 配置](../../admin-web/wrangler.toml)
- [云开发规范](../CLOUDBASE.md)、[部署手册](../DEPLOYMENT.md)、[运营手册](../OPERATIONS.md)

CloudBase 官方的[环境配置概述](https://docs.cloudbase.net/envconfig/intro)说明了环境级安全来源、API Key、调用限制和网关鉴权的配置入口；以上资源拆分和发布门禁是本项目的实施方案，不代表第二环境已存在。
