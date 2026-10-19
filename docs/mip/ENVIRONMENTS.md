# 测试与生产环境方案

本页记录 2026-10-15 拍板的测试/生产环境方向与落地前提。方案描述不表示任何新资源已创建或清洗已完成；实际状态以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 与目标环境回读证据为准。不把真实 AppID、EnvID、VPC、UIN、runtime 用户或密钥写入文档。

## 已拍板的方向（2026-10-15）

现有全部资源原地转正式生产；测试环境全部新建。同实例多库（schema）方案作为成本约束下的选择：第二个 CloudBase 环境需要第二份包年费用，排除。CloudBase 托管 MySQL 同实例多逻辑库、函数按用量计费不按个数、Cloudflare Pages/D1 免费层，均为既有核对结论（2026-09-27 只读检查）。

| 资源 | 生产（现有资源原地） | 测试（全部新建） |
| --- | --- | --- |
| CloudBase 环境 | 现有唯一 EnvID | 同一环境内共享 |
| MySQL 库 | 现有默认库；发布前完成数据清洗（清单另行核对确认） | 同实例第二库；只执行迁移与正式配置导入 |
| 云函数名 | 现有默认 `mip-*-api`（正式版已烘焙，不可变更） | `MIP_*_FUNCTION_NAME` 全套显式覆盖为 `mip-t-*`（21 个，含支付三函数与调度器） |
| runtime MySQL 账号 | 现有账号 | 第二派生账号，只授测试库 `mip_*` 表级权限 |
| 对象前缀 | `mip/` | 独立测试前缀，各套函数只写自己的前缀 |
| 管理后台 | 现有域名与 CloudBase 直连入口，不动 | `test.admin.mip.cool`：CloudBase 同构第二后台（2026-10-16 改判，替代本页早先的 Cloudflare Pages 方向）；新静态前缀、新 BFF 函数、测试专用认证 schema、独立密钥 |
| 小程序 | 正式版（构建自生产目录） | 开发版/体验版（构建自测试目录，烘焙 `mip-t-*`） |
| stage/catalog/payment | `production` / `LIVE` / 支付独立验收后 `live` | `test` 或 `staging` / `TEST` / `disabled` 或 `test` |

安全默认随之反转：`src/config/defaults.ts` 的兜底函数名应改为指向 `mip-t-*`，使「未配置环境的误构建」打向不存在的测试函数（响亮失败）而不是生产。两份目标目录都必须显式写全 21 个函数名，不依赖 defaults 兜底。

## 支付环境切分

微信支付没有沙箱。`MIP_PAYMENT_MODE=test` 与 `live` 使用同一 `subMchId` 真实扣款；`test` 仅把支付记录的 provider 记为 `TEST`（`cloudfunctions/mip-cloudpay/domain/payment.js`）。商户绑定是 AppID/环境级资源，两套函数共享绑定，差异化只靠各自注入的 `subMchId`。

- 自动切换口径：支付旋钮（`MIP_PAYMENT_MODE`、`WECHAT_PAY_MERCHANT_ID`、`--confirm-live`）属于各目标目录 env 配置；生产发布链在支付验收通过前保持 `disabled`，通过后由发布命令自动追加 `--confirm-live`。不存在需要人工切换的运行时开关。
- 测试环境支付三选一：① 同一商户号 + TEST 目录价（真实小额、`refunds:run` 可退，能测全链路）；② 客户第二商户号绑定同一环境、测试目录配置其 mchid（资金面完全隔离）；③ 测试目录 `disabled` + 管理端免费补录（零资金流，测不到支付链路）。

## 数据清洗与初始化

生产库在正式发布前完成一次清洗，口径：

- 下架全部演示种子活动（`seed.demo.json` 标记 `replaceBeforeProduction: true` 的固定 ID 资源：演示用户、演示分支、演示会员方案、演示活动、演示 banner/公告）。
- 清理测试期活动草稿、测试报名/签到/订单；真实用户的历史保留。涉及资金的状态（PAID/REFUND_PENDING）先对账再处置。
- 生产初始化不复制演示用户、合成签到、测试订单或测试权益；正式配置导入沿用 [DEPLOYMENT.md](../DEPLOYMENT.md) 与 [IDENTITY_MIGRATION.md](../IDENTITY_MIGRATION.md) 的备份校验流程。

测试库只执行迁移与正式配置导入；`seed:demo` 允许在测试库运行（`--confirm-demo`，staging 条件下追加 `--confirm-staging-demo`）。不做常态化的生产→测试数据复制：手机号/UnionID 加密 pepper 按目标派生，生产副本的身份字段在测试环境不可解密，复制只产生不可验证登录的摆设数据。

清洗执行规则：资金与权限相关处置先逐项人工确认；写库走 `runStatement` 并回读 `rowsAffected`；删除前完成仓库外逻辑备份；状态不可逆操作优先走管理端操作以保留审计。

## 工程改造清单（测试环境落地前提）

现有代码还不能仅靠配置运行同环境双库，以下改造在测试环境创建前完成：

- 目标库显式化：`deploy-functions`、`apply-mip-schema`、备份、seed、grants、`verify-cloud`、owner bootstrap 全链传显式 schema 并增加确认参数；当前 targetSchema 从实例默认库推断（`scripts/deploy-functions.mjs`）。
- runtime 账号派生加库维度：`runtimeUserForEnvironment(envId)` 改为 (envId, schema) 派生；调用点为 `deploy-functions.mjs`、`converge-mip-runtime-grants.mjs`、`verify-cloud.mjs`、`project-init.mjs`。两账号各自只授本库表级权限，既有表级精确授权断言天然校验跨库隔离。
- env 目录加载器：`loadCaseEnv`（`scripts/lib/example-cloudbase.mjs`）与 `weapp-vite.config.ts` 支持 `MIP_ENV_DIR`，目标配置目录（gitignore）各持 `.env.local` 与 `.env.secrets.local`。
- ops 编排脚本：`--target=test|production` 串联 迁移 dry-run → apply → project:init → grants → cloud:deploy（自动拼接全部 `--confirm-*`，production 追加 `--confirm-production`）→ `cloud:verify`；owner bootstrap 与支付验收不进自动链。
- admin 拆分：测试后台按 CloudBase 同构路线部署（2026-10-16 拍板，对象清单与约束见 [ADMIN_TEST_BACKEND_HANDOFF.md](ADMIN_TEST_BACKEND_HANDOFF.md)）。现有部署脚本硬编码生产命名（`mip-admin-web-api`、`mip-admin-console/`、`mip_admin_auth`，且 BFF 部署仅允许默认网关 origin），需先参数化测试命名并保留全部安全守卫；测试端 `MIP_ADMIN_UPSTREAM_URL` 指向 `mip-t-admin-api`；测试函数集的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` 已显式指向测试域名。
- 媒体与订阅消息：媒体前缀已按 stage 注入（`mip-media-api/domain/service.js` 的 `mip/${stage}/...` 对象键，2026-10-15 核验，无需改造）；订阅模板为 AppID 级资源，两套函数共享同一批模板，模板层无法隔离，测试环境默认站内信兜底。既有栈转 production 后历史对象仍留 `mip/staging/` 前缀，按行内 key 精确读取、无跨读风险；测试环境继续写 `mip/staging/` 与其存量共存，key 内含随机 assetId 无碰撞面。

## 构建与配置隔离

两份 gitignore 的目标配置目录对应两个构建目标；正式版从生产目录构建上传，体验版从测试目录构建上传。体验版标签不保证连接测试环境——烘焙的函数名才决定目标，构建后核对产物内的函数名常量。每次上传前完整 `pnpm verify:all` 门禁不变。

CI 不自动部署生产：API Key 的 CAM 权限边界是既有现状，生产部署保持本机 Device Flow 授权与人工触发；自动化到「一条命令按目标目录跑完整链」为止。

## 管理后台隔离

`admin.mip.cool` 与 CloudBase 直连入口为生产后台，域名不动。测试后台 `test.admin.mip.cool` 走 CloudBase 同构路线（2026-10-16 拍板，替代 2026-10-15 的 Cloudflare Pages 方向 B）：独立静态前缀 + 独立 BFF 云函数 + 测试专用认证 schema + 独立 `MIP_WEB_ALLOWED_ORIGIN`、会话密钥、登录/QR HMAC；BFF `MIP_ADMIN_UPSTREAM_URL` 指向测试函数集的 `mip-t-admin-api`；云函数侧登录确认 URL 对应测试域名。两端 HMAC 同环境内对应、不跨环境复用。测试后台的登录与授权不能作为生产授权；测试认证数据与生产认证库完全隔离。部署对象清单与脚本改造约束见 [ADMIN_TEST_BACKEND_HANDOFF.md](ADMIN_TEST_BACKEND_HANDOFF.md)。

## 每套部署目标独立完成 owner 引导

这里指 MIP 应用的 `PLATFORM_OWNER`，不是微信公众平台管理员，也不是腾讯云资源管理员。

1. 用户通过连接该目标的小程序真实登录，完成手机号授权、昵称、主分会与当前协议；不复制 OpenID 绑定，不把 demo 账号提升为管理员。
2. 维护者在目标目录本地配置设置 `MIP_OWNER_PHONE`。
3. 先验证目标凭证，再执行引导：

```bash
pnpm cloud:status
pnpm admin:bootstrap -- --confirm-env=<该目标的精确EnvID> --confirm-owner
```

4. 脚本以 AppID 范围手机号哈希定位唯一 ACTIVE 非 demo 用户，复核资料与协议后授予 owner 并读回角色、写审计；候选缺失或不唯一时停止。
5. 用户在对应目标的后台完成「现场工作台 → 确认网页登录」六位码确认，检查操作权限与审计。

生产引导需明确授权并核对目标；不要虚构脚本不检查的确认参数。生产云函数部署已有 stage 检查与 `--confirm-production` 门禁。

## 实现入口

- 云配置加载器（`scripts/lib/example-cloudbase.mjs`）
- [小程序构建配置](../../weapp-vite.config.ts) 与 [运行配置](../../src/config/runtime.ts)
- 云函数部署脚本（`scripts/deploy-functions.mjs`）、支付部署（`scripts/deploy-payment-function.mjs`）
- owner 引导脚本（`scripts/bootstrap-owner.mjs`）
- 后台发布命令（`admin-web/package.json`）与 CloudBase 后台部署脚本（`scripts/deploy-admin-cloudbase.mjs`）
- [云开发规范](../CLOUDBASE.md)、[部署手册](../DEPLOYMENT.md)、[运营手册](../OPERATIONS.md)

清理时按每个业务资源自身的来源判定归属，不能因为它引用了演示图片或目录就级联删除该业务资源。外键保留检查之外，还要检查订单的多态 `resource_id`，保留真实支付的完整关联。被真实业务复用的目录/素材保留；合成账号可保留不可登录的审计占位。云文件先备份并验哈希，再逐 Key 删除；`queryStorage info` 的泛化错误不证明文件不存在，应列出父目录并核对完整 Key，目录中其他文件不属于删除授权。
