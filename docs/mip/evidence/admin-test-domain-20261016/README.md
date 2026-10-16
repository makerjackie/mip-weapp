# 测试后台域名绑定验收 · 2026-10-16

> 本文为首次绑定时的验收快照；后续自动续期、完整门禁修复及 Git 同步以[同日续期验收](../admin-test-renewal-20261016/README.md)为准。下方当时的 NOT_ENABLED / 门禁失败记录保留，不能当作后续现状。

入口：<https://test.admin.mip.cool/>。结论：**DOMAIN_HTTPS_VERIFIED**；密码登录 **BLOCKED_MISSING_TEST_ACCOUNT**；微信真机确认 **NOT_RUN**。本记录证明域名、证书、目标资源和未登录认证流程，不代表活动功能或完整登录闭环验收通过。

## 已执行及证据

- 域名管理和权威 DNS：阿里云；公开 NS 回读为 `dns23.hichina.com` / `dns24.hichina.com`。保留用户已添加的 CNAME `test.admin` → `test.admin.mip.cool.tcbaccess.tencentcloudbase.com`；在 `mip.cool` 区域只新增该订单要求的 `_dnsauth.test.admin` TXT，回读记录启用及公开递归 DNS 的准确值。没有修改根域、泛解析或邮件记录。
- 免费 DV 证书 `bcL4Ap00`：腾讯云控制台已签发后才绑定。实际 TLS 主机名为 `test.admin.mip.cool`，信任校验通过；有效期至 **2027-01-14 07:59:59 UTC（北京时间 15:59:59）**。公钥证书指纹、签发者及有效期见 [HTTPS 探针](https.public.json)。未下载或保存证书私钥。
- 网关：`DIRECT`、`Status=SUCCESS`、`DNSStatus=OK`、`PlatformCnameDNSStatus=OK`；只更新目标域名的 `CertId` 和 `Protocol=HTTP_TO_HTTPS`。真实 HTTP 返回 307 并跳转同域 HTTPS。完整前后回读比较证明其他域名未变；目标原三条路由逐项保持原配置，见[绑定与配置报告](binding.public.json)。
- 目标 `/` → `STATIC_STORE/staticstore`，`StaticStorePrefix=/mip-admin-console-test`；`/api`、`/assets` → `SCF/mip-t-admin-web-api`，均保留路径透传。测试 BFF 允许的主 origin 为测试域名，认证 schema 为 `mip_test_admin_auth`，业务上游为 `mip-t-admin-api`；CloudBase 安全域名已为 `ENABLE`。
- 现有测试静态部署清单的 **14/14** 文件，HTTPS 回读的大小、SHA-256、MIME 全匹配。入口为 `/assets/index-dbH29RjD.js`，见 [资产报告](assets.public.json)。清单来自 `.worktrees/test-admin/.tmp/admin-cloudbase-static/verified.private.json`（2026-10-16 09:13:58 UTC）。测试 checkout 提交为 `bad246c3`，部署参数化另有该 checkout 中的未提交改动；本轮没有重新发布产品代码，也不把这个产物称为另一条本地开发线最新活动功能版本。
- 真实浏览器加载同一入口 JS，登录页在 **1280×720、1440×900、390×844** 实际 CSS 视口均无横向溢出，见 [浏览器记录](browser.public.json)。记录实测 `innerWidth/innerHeight`，已恢复临时视口。本机截图见下方私有证据位置。
- [HTTPS 探针](https.public.json)最终 **8/8 PASS**：TLS、HTTP 跳转、缺失资产 404、匿名后台 401、外域来源 403、真实六位登录码生成、challenge Cookie 的 Secure/HttpOnly/SameSite、携带 Cookie 的 PENDING 轮询。只生成短期认证 challenge，没有伪造管理员确认，没有业务写入。首次探针误用了字段及 Cookie 名，按实际 `code` / `state` / `mip_admin_login_challenge` 契约修正后重新执行；失败草稿不能视为服务端故障或通过证据。

## 同步修正的测试登录回调

测试 `mip-t-admin-api` 原来的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` 已指向测试域名，但 `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 仍指向正式域名。服务端会把 `9xxxxx` / `z_` 范围送往 migration URL，因此只改主回调会让测试码误入正式 BFF。

本轮通过配置更新守卫，仅把测试函数的 `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 改为 `https://test.admin.mip.cool/api/internal/auth/challenge/confirm`，并同步实际测试配置目录；回读函数 Active、两条回调均为测试域名，BFF 与测试 admin-api 的登录及 QR HMAC 分别匹配（仅记录布尔值）。完整环境变量、runtime、handler、角色、VPC、超时等均按前后快照校验保留。没有更新正式函数、放宽来源校验或共享生产认证数据。

## 尚未通过的事项

- `verify-admin-cloudbase --origin=https://test.admin.mip.cool` 已实际执行，在开始前因缺少本机 `MIP_ADMIN_TEST_PHONE` / `MIP_ADMIN_TEST_PASSWORD` 停止。没有尝试把生产密码或哈希复制到测试认证库；需测试管理员先通过测试小程序确认登录并由本人设置密码，才能运行完整密码、会话、只读业务和退出验收。
- 测试小程序 → 测试 admin-api → 测试域名的真机确认、二维码扫码和登录后非空业务数据未验收。配置与 challenge 成功不替代真机成功。
- 新测试域名**尚未启用自动续期**。正式后台既有续期任务只处理 `admin.mip.cool`，本轮没有挪用或扩大其权限。首次证书绑定不是自动续期验收。
- 静态清单验收助手已支持明确选择 `MIP_ADMIN_CONSOLE_PREFIX`，继续拒绝正式/测试清单混用、非法目录、路径越界和不匹配字节。专项套件 **5/5 PASS**、修改文件 ESLint、文档链接与 skill 校验通过。
- 根 `pnpm verify:all` 在既有 `scripts/qa/admin-event-e2e.mjs` / `admin-ui-e2e.mjs` 的 43 项 lint 错误处失败。单独 `pnpm admin:web:verify` 在 America/New_York 时区因现有用户列表测试把 `2031-01-01` 显示成上一年而失败；`TZ=UTC pnpm admin:web:verify` 全部通过。这些结果来自当前根 checkout `9ef2b0ee` 加本轮验收助手改动，不冒充测试部署的全量发布门禁。本轮只修改云端域名和测试回调配置，没有上传微信版本或重新部署业务代码。

## 本机私有证据与复用入口

`.tmp/admin-test-domain-20261016/` 保留完整前后网关/函数回读、绑定结果、签发控制台截图、三种视口截图、探针与门禁日志；配置类文件 0600，不提交账号、Cookie、challenge、环境密钥、完整控制台身份信息或私钥。原始签发控制台截图只在本机。

后续绑定按 [mip-admin-release skill](../../../../.agents/skills/mip-admin-release/SKILL.md) 的[自定义域名流程](../../../../.agents/skills/mip-admin-release/references/custom-domain.md)执行，登录码问题按[登录链路验证](../../../../.agents/skills/mip-admin-release/references/login-verification.md)核对。成功经验和 DNS 归属已补入现有 skill，不再建立另一份并行操作手册。
