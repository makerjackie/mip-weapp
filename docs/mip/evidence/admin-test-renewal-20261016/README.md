# 测试后台证书续期验收 · 2026-10-16

目标 <https://test.admin.mip.cool/>。结论：**AUTO_RENEWAL_ENABLED_AND_REAL_REPLACEMENT_VERIFIED**。每日检查已启用，实际 timer canary 与一次真实免费申请、CA 签发、网关绑定、可信 TLS 指纹闭环全部通过。

## 实现与隔离

- 复用 `cloudfunctions/mip-admin-cert-renewer/` 的四个运行文件，为测试目标部署独立 `mip-t-admin-cert-renewer`；未复制第二份函数源码。`renewalTarget(domain)` 统一选择测试/正式函数、BFF、静态前缀、timer、角色与策略。
- 测试专用 `MIPTestAdminCertRenewerRole` 只信任 SCF，唯一关联 `MIPTestAdminCertRenewerPolicy`。权限为免费 SSL 申请、同账号未来证书的必要读取/验证、当前 CloudBase 环境网关证书修改、测试域名专用 COS 状态及验证文件、专用 CLS 日志。网关 API 的 IAM 粒度是环境，精确域名和三条既有路由另由源码硬校验；不能称 IAM 已限制到单个域名。
- Runtime 使用 SCF 本次临时凭证；没有本机登录态、长期云密钥、阿里云密钥、数据库连接或 VPC。禁止 SDK 客户端调用，无 HTTP 入口。日志保留七天，单分区，关闭自动分裂、索引与匿名上传。免费 DV 证书之外的 SCF/COS/CLS 使用仍受平台额度与计费规则约束。
- 证书剩余有效期 ≤30 天时申请新免费证书，使用 FILE 验证；状态、HMAC、generation、申请记录和日志按测试域名独立。原子 create-only 申请记录防止并发/响应不明时重复消耗额度。详情接口仅在已签发时读取，公钥用于计算指纹，含私钥的原始响应不保存、不输出。
- 平台 ZIP SHA-256 为 `4067bfe308009ea94db78d450be88fe1eb8f38c651004c25db45010281bf526b`；四个运行文件已下载逐字节匹配；源码标记 `242602607ce63d33122992c7a05e6597d5dc9b0dd97bfc078271618d4a8cbe3a`，策略摘要 `d92c3d11eebc0b03`。

## 最终运行证据

- [续期状态](renewal.public.json)：2026-10-16 **10:30:45.113 UTC** 记录 `RENEWED`，证书从 `bcL4Ap00` 替换为 **`bcOr1nou`**，无 pending、无需人工对账。实际 TLS 到期为 **2027-01-14 08:59:59 UTC / 北京时间 16:59:59**；SHA-256 指纹 `84:AB:6D:88:34:00:42:6A:BE:2B:37:2F:1F:DD:39:F8:F5:BE:07:DB:5C:B4:FD:91:83:F5:6A:12:CF:7B:FE:E8`。
- [最终审计](audit.public.json)：生产续期函数的配置、代码摘要及完整 timer 均与操作前一致；其他网关域名不变。测试函数 Active，下载四文件再次匹配，唯一每日 timer 为 OPEN，SDK 客户端调用禁止，无 VPC/HTTP 入口。
- [公开 HTTPS](https.public.json) **8/8 PASS**，独立 TLS 探针得到与 `lastSuccess` 一致的新指纹，HTTP 307、缺失资产 404、匿名管理请求 401、外域来源 403、登录 challenge 与 Cookie 保护均正常。
- [静态资产](assets.public.json) **14/14 PASS**，入口仍为 `/assets/index-dbH29RjD.js`。本轮没有替换产品前端字节。
- [真实浏览器复查](browser.public.json)：续期后重新打开测试站，标题为「MIP 运营管理」，仍加载同一入口 JS，1465×840 的当前 CSS 视口无横向溢出，显示登录弹窗；未把未登录页面称为账号验收成功。首次绑定时的三个标准视口记录另见原报告。
- 第一轮签发后绑定检查曾返回 `CERT_TLS_NOT_PROPAGATED`；保留同一个 pending 证书并重查后成功，没有再次申请，也没有把这次临时失败计作通过。

## 已处理的实际问题

1. 首次 SCF 创建报 `ClsLogSetId & ClsTopicId not matched`。真实 CLS 回读表明 ID 对应，但委托凭证创建的日志带 `AssumerName=TCB`；换用控制台创建的账号自有资源后 Active。新增同名服务/自有资源选择与服务归属回读拒绝测试。只替换该测试角色的单一日志写入目标，没有扩展至其他主题或修改共享角色。失败资源的日志集/主题已按本次创建记录精确清理，保留私有回读，未保留重复计费资源。字段定义见[腾讯云 CLS 数据结构](https://cloud.tencent.com/document/api/614/56471)。
2. 第一轮 offset=0 的单次 timer 未执行。核对旧任务真实 canary 凭据后暂停该计划，改为 offset=480；第二轮在 **2026-10-16 10:26:41.558 UTC** 实际自行执行，私有 COS 写入匹配本次 generation 的 `lastCanary`，且 `guard=COS_CREATE_ONLY`。这证明 timer 与同名第二次写入拒绝均真实发生，未用手工 Invoke 冒充 timer。
3. 激活后每日 cron 为 `0 17 11 * * * *`，按已验明的 UTC+8 解释，目标 **UTC 03:17 / 北京时间 11:17**。原生 Invoke 首次 CHECK 返回 `NOT_DUE`、剩余 90 天；随后仅 FORCE 一次进行真实免费签发闭环。

## 源码门禁与同步范围

交付分支 `codex/test-admin-renewal-20261016`；主 checkout 另有 `5ec31031` 的并行合并现场，因此不改其 index、不强行快进 main。本分支通过无文件差异的合并保留截至 `ff1a3d8e` 的主线提交历史；本报告对应本分支受验收快照，不覆盖另一任务的 Cloudflare 退役/部署参数化验收。

集成工作区保留本地活动开发线与远端环境/支付开发线；没有 reset、强推或代提另一工作区的未提交改动。完整 `TZ=UTC pnpm verify:all` 通过：小程序 274 文件 / 1770 测试、服务端合同、Web Node 合同 294 测试、React 28 文件 / 182 测试、两端构建及 responsive contract。续期 native node 测试 14 项通过，skill 结构校验和文档链接检查通过。

另修复两份 QA 脚本的既有 lint 问题，并保留 Playwright `innerText()` 的可见文本语义；未执行这两个有业务写入的 E2E 脚本。三处日期测试改为按机器本地时区计算展示期望，保留原 timestamp 及断言，没有靠指定时区掩盖失败。

本轮没有重新发布活动 UI、BFF 或微信体验版。静态站版本与完整登录的证据边界见[首次绑定报告](../admin-test-domain-20261016/README.md)。合并/推送 Git 不代表这些产品改动已部署。

## 待单独验收

- `MIP_ADMIN_TEST_PHONE` / `MIP_ADMIN_TEST_PASSWORD` 尚未配置，账号级 HTTPS 登录及登录后业务功能为 BLOCKED；测试小程序确认/扫码登录仍待真机。没有复制生产密码或身份数据。
- 未验收告警通知接收；执行错误会写平台日志。证书真正到期前三十天的未来自然触发，不能由本次 FORCE 实测替代；本次需同时具备实际 timer 与免费签发/替换证据才称续期机制验收通过。
- 活动 PRD/原型逐项对照、创建/编辑/报名/订单等完整产品验收另行进行，本报告不代表“所有功能正常”。

## 私有证据与接手入口

`.tmp/admin-test-renewal-20261016/` 与 `.tmp/admin-cert-renewal-test.admin.mip.cool/` 保存完整云端前后回读、源码 ZIP、角色控制台 JSON、定时参数、状态与本机截图；敏感文件 0600，不入 Git。完整门禁日志在集成 worktree 的同名 `.tmp/admin-test-renewal-20261016/`，交付时保留到主 checkout。简明接手说明：[ADMIN_TEST_DOMAIN_HANDOFF.md](../../ADMIN_TEST_DOMAIN_HANDOFF.md)。复用流程：[mip-admin-release](../../../../.agents/skills/mip-admin-release/SKILL.md)。
