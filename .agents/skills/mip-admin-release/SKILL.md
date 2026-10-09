---
name: mip-admin-release
description: 更新、部署本仓库的 CloudBase Web 管理后台，并验证实际访问的运行产物是否对应目标代码。用于拉取最新后台、发布 admin-web、核对线上版本或排查部署后白屏；不自动上传微信版本或下线 Cloudflare。
---

# MIP 管理后台发布

把本次目标代码发布到已配置的 CloudBase 后台，同时提供代码包、公开静态资源和真实浏览器证据。沿用现有脚本；创建本 skill 不代表授权任何后续部署，执行时按当次用户请求确定范围。

## 入口与范围

先读根 `AGENTS.md`、`admin-web/AGENTS.md`、[文档入口](../../../docs/README.md)、[CloudBase 运行说明](../../../admin-web/cloudbase/README.md)及[当前状态](../../../docs/mip/PROJECT_STATUS.md)。云资源边界见 [CLOUDBASE.md](../../../docs/CLOUDBASE.md)。

- `admin-web/dist/` → 独立静态前缀 `mip-admin-console/` → 网关 `/`。
- `.tmp/admin-cloudbase-function/` → `mip-admin-web-api` → 同源 `/api` **及 `/assets`**。
- BFF → HTTPS `mip-admin-api`；需要发布的其他业务函数由本次 diff 和调用链决定。
- 原域名可能仍经 Cloudflare 跳转；“CloudBase 入口工作”不等于“Cloudflare 已下线”。

需要绑定独立后台域名时，按[自定义域名流程](references/custom-domain.md)完成证书、网关、DNS 与登录来源的闭环。保留默认 CloudBase 发布 origin，自定义域名作为同一套产物的额外入口。

目标环境、阶段、完整 HTTPS origin、runtime 用户及测试账号从仓库本机配置和目标环境回读确定，不硬编码历史环境 ID、域名、账号、提交或资产数量。用户提供的测试域名缺字时，核对配置中的真实 origin，不能猜测或创建新网关。

## 拉取与门禁

1. 审计 Git 状态、暂存区、分支与远程；保留并行改动。普通同分支同步用 `git fetch` 和 `git pull --ff-only`；有分歧时检查原因，不 reset、clean 或强推。
2. 从 diff 确定前端、BFF、业务函数、契约与迁移范围。Web 改动反向检查小程序消费者；不因后台发布而上传小程序，不全量重部署无关函数。
3. 使用 `.nvmrc` 和 `packageManager` 指定的工具链。发布快照必须通过根 `pnpm verify:all`，前端使用 `VITE_MIP_ADMIN_DEMO_MODE=false`。该命令已包含两端门禁，不重复堆叠同一套检查；代码改动使旧证据失效时重跑。
4. 固定本次发布提交，检查自有暂存 diff 后按任务授权提交、推送并回读远端 SHA；若未要求同步远端，明确记录本地发布快照。不得把未检查的并行源码混入产物。

## 发布前保存与认证

先执行 `pnpm cloud:status`，使用日常环境级 API Key。创建唯一的 `.tmp/admin-release-<本次标识>/` 保存本轮私有回读；不要依赖被上次任务覆盖的临时目录。

对将更新的函数保存完整配置、权限、触发器和代码包。使用仓库 `callCloudbase`/MCP 的 SCF `GetFunctionAddress` 获取 ZIP 与 `CodeSha256`，下载后校验摘要，安全解包（拒绝绝对路径、`..` 和符号链接）。配置、ZIP 地址、凭证及会话只保留在本机忽略目录，敏感文件 `0600`，不打印值。保存网关路由和当前 HTML/入口 JS，便于证明更新范围与回滚。

控制面受 API Key 权限限制时，先检查操作是否已经上传代码/修改配置；**失败退出码不等于没有部署**。可复用同权限的既有官方 CLI/SDK/本机登录态；不要改写 auth.json 或拼接刷新 token。Device Flow 依根 AGENTS.md 的维护者授权规则执行，不能自动发起新授权或扩大权限。

若代码已 Active，但原生 `Invoke` 健康探针被 CAM 拒绝：单独记 `BLOCKED`，继续做获授权的代码/配置/权限/触发器回读和真实 HTTP 读取。不得把原命令记作成功或称原生健康通过；独立证据不能自动取消仓库要求的门禁。若强制检查仍未完成，明确保留该项阻塞。

## 同步发布静态与 BFF

**`/assets` 来自 BFF 内置 `public/`。只上传静态网站，新 HTML 就可能引用旧 BFF 不存在的哈希 JS，造成 404/白屏。**

已有网站的滚动发布：

1. 通过完整门禁生成真实模式 `admin-web/dist/`；执行 `node admin-web/scripts/build-cloudbase.mjs`。
2. 将已校验的上一版 BFF `public/assets` 中新包缺少的不可变哈希资产保留到 `.tmp/admin-cloudbase-function/public/assets/`。同路径字节不同立即停止排查；不覆盖新 `index.html`、服务端代码或配置，不带 source map/私钥/Cloudflare 元数据。优先依据上一版实际入口及资产清单，避免无限累加过期包。
3. 业务源码有变化时，在切换依赖它的前端前部署明确的兼容业务函数：

   ```bash
   pnpm cloud:deploy -- --confirm-env=<目标环境> --confirm-runtime-user=<已核实用户> --only=<受影响函数>
   ```

   需要迁移时按仓库迁移流程先备份、追加应用并回读；不把 schema 改动塞进静态发布。非兼容 API/数据变化必须先设计协调发布，不能直接套以上顺序。
4. 先发布兼容 BFF，确认 Active、配置与代码，再上传新静态入口：

   ```bash
   node scripts/deploy-admin-cloudbase.mjs --confirm-env=<目标环境> --confirm-function=mip-admin-web-api
   node scripts/deploy-admin-cloudbase-static.mjs --confirm-env=<目标环境> --confirm-prefix=mip-admin-console/
   ```

   production 必须依现有脚本追加 `--confirm-production`。静态脚本只操作隔离前缀，不删除历史文件或修改共享托管根配置。初次部署另按运行说明准备认证 schema 与路由；日常更新不重复建库/迁移账号。

## 三层发布证据

### 函数与配置

重新下载最终 ZIP，核对 SCF 摘要，再逐文件比较：BFF 包对实际发布目录；业务函数对本次提交的全部运行 JS/JSON。校验 Active、角色/VPC/超时/内存/公网配置、环境变更键、SDK 权限、触发器与网关。允许的配置变化要能解释，不展示秘密值；BFF 禁止 SDK 客户端调用、管理 API 保持已认证调用，管理 API/BFF 无定时器。

不把“update 接口成功”或“Status=Active”单独当成源码一致证明。若回滚，恢复经校验的匹配静态/BFF 包，保留认证与旧 challenge 回调。

### 公开 HTTPS

静态部署脚本的 `verified.private.json` 是本次发布清单。用配套仓库只读助手核对**实际入口域名**的每个文件字节：

```bash
node scripts/verify-admin-live-assets.mjs \
  --origin=<配置中的完整HTTPS-origin> \
  --manifest=.tmp/admin-cloudbase-static/verified.private.json \
  --output=.tmp/admin-release-<本次标识>/assets.public.json
node --experimental-strip-types scripts/verify-admin-cloudbase.mjs --origin=<相同origin>
```

助手拒绝 origin 不符、重定向、HTTP 错误、大小/摘要不符和资源 MIME 错误；报告不记录 origin/环境 ID/凭证。它只证明清单中的静态字节，不能替代函数、认证或浏览器验收。

现有 HTTPS 验证器使用已配置测试账号，检查真实认证、Cookie、来源防护、只读模块和退出。以本次生成报告为准，不固定历史检查数量。列表修复另覆盖**非空服务端 DTO 到页面、真实中文/状态搜索、无匹配空态和分页**；空响应和 mocked 类型声明不足。UUID 的 ASCII 列不得直接比较中文搜索词；LIKE 转义与作用域/分页筛选仍由服务端执行。

### 浏览器

在实际部署 URL 重新加载页面并真实登录；核对 DOM 中加载的入口 JS 与清单一致，确认正文是真实业务数据。检查受影响列表/筛选、控制台错误，按 admin-web 规则验证桌面及手机视口（1280×720、1440×900、390×844，无页面横向溢出），保存本机截图并恢复临时视口。

CloudBase 自身测试域名提示与浏览器证书安全警告不同；后者按工具规则交给用户处理。微信扫码/确认码登录、支付等必须分别记录真机边界。回读登录分流配置只证明配置存在，不证明微信确认成功；普通发布不重复改 challenge 命名空间/QR 环境或退役旧平台。

## 交付

动态事实仅更新 `docs/mip/PROJECT_STATUS.md` 和对应 `docs/mip/evidence/`；skill/运行手册只记录可复用流程。报告包括发布提交、平台包 SHA/文件匹配、当前入口、真实 HTTPS/浏览器结果及阻塞项。入库前去除环境 ID、身份、凭证、Cookie 和个人字段；日志/配置/带私人数据截图留本机。

用中文说明实际访问是否是本次版本，并给出正确链接；Cloudflare 直连、别名跳转和旧站保留要分别说明。文档或 skill 提交不会改变线上运行代码，也不自动触发再次部署。

本流程的原始运行证据：[2026-10-09 发布记录](../../../docs/mip/evidence/admin-release-20261009/README.md)。其中原生健康探针为 BLOCKED，不是“所有检查都成功”的样板。
