# 管理后台证书续期实施记录

日期：2026-10-09。范围为 `admin.mip.cool` 的独立 HTTPS 证书任务；后台页面、业务函数、数据库和 DNS 未改动。

当前结论：**ENABLED，真实签发、自动绑定和可信 TLS 闭环通过。** 专用续期函数已部署，单次定时器真实执行并验证原子申请保护，每日 CHECK 已启用。每天北京时间 11:17 检查，剩余有效期不超过 30 天时申请免费 FILE 证书，签发后自动替换。

## 部署与运行证据

- [部署回读](deployment.json)：`mip-admin-cert-renewer` 为 Active，专用角色、独立 7 天 CLS、无 VPC/数据库/HTTP 入口，SDK 客户端调用禁止。下载平台 ZIP 的 SHA-256 为 `80565d85c5bfca575862acb6c441826f2cc85339435f61ed9ad204d6e95dbde4`，四个运行文件与[源码清单](source.json)逐字节一致，源码指纹 `6acc75f301ea363d5cd57c767e34796f4ac8e9ec8dc7ebb0a61d8b6603734130`。
- [定时与续期回读](operation.json)：最终版本的 CANARY 实际执行于 `2026-10-09T14:25:11.074Z`，`COS_CREATE_ONLY` 保护通过；唯一 timer 为 `mip-admin-cert-daily`，cron `0 17 11 * * * *`、OPEN、签名 CHECK。真实执行验证 CloudBase cron 时区为 UTC+8，不把创建 timer 的请求成功当执行成功。
- 一次提前续期实测申请免费订单 `bRTCTBmo`，验证文件由函数写入并通过公开 HTTPS 字节比对，CA 已签发；函数自动把网关从 `bRDuUBbd` 切换到新证书。新证书传播期间保留 pending 并复查，没有重复申请。最终 `RENEWED` 于 `2026-10-09T14:23:20.318Z`；pending 和 reconciliation 均为空。
- [实际 TLS](tls.json)：云端函数与独立公网连接均受信任，叶证书 SHA-256 指纹与 CA 新证书匹配；有效期至 **2027-01-07 20:59:59（Asia/Shanghai）**。函数回读确认三个路由、安全属性和其他域名保持不变。
- [公开资源](assets.json)：证书切换后 14/14 个文件与既有发布清单逐字节一致，入口仍为 `index-CYFT5GuB.js`，前端运行源码沿用 `d69d9b73`。
- [认证复验](auth.json)：7/7 通过，覆盖真实密码登录、Secure/HttpOnly/SameSite Cookie、运营会话、概览读取、退出、退出后会话重放拒绝及 HTTP→HTTPS。浏览器重新加载后显示已验证会话、真实非空概览，并核对相同入口 JS；截图只保存在本机忽略目录。
- DNS 实际 CNAME 为 `admin.mip.cool.tcbaccess.tencentcloudbase.com`，目标后台直连 CloudBase；旧 Cloudflare 别名和旧站未处理。

## 权限与验证

- 用户已明确批准专用角色，并完成 MFA 与 Device Flow 部署授权。运行凭证仅为 SCF 临时凭证；账户登录态留本机，未进入仓库或云函数。
- `MIPAdminCertRenewerRole` 只信任 SCF，唯一关联精确专用策略；9 个权限语句覆盖免费申请、原证书范围内的信息/详情/验证、当前环境网关、隔离 COS 状态/申请记录/验证文件和专用日志。不修改共享角色，不授予删除、付费购买或业务数据库权限。
- 原生并发限制接口返回 `FailedOperation.UpdateFunctionConfiguration`，不宣称单并发已启用。实际使用 COS 禁止覆盖的永久申请记录保护，同名二次创建必须被拒绝；状态桶版本控制元数据读取和真实 CANARY 均通过，测试也覆盖两个并发调用只申请一次。
- 13 个运行测试、10 个部署/权限测试及最终完整 `pnpm verify:all` 通过。覆盖真实 FILE DTO 的完整域名字段、信息接口不含 PEM/详情接口提供公钥、30 天边界、并发/超时防重复、签名与路由隔离及真实 TLS 传播前不得记成功。
- 已启用云监控 `MIP-admin-certificate-renewal-errors`：仅绑定该函数的 `$DEFAULT`，一分钟错误数大于零告警，使用既有系统默认通知模板。账号 SSL 到期提醒订阅已开启。**邮件/短信实际接收未由用户确认**；不将配置回读当通知送达证明。

## 实测发现与边界

CloudBase 创建须传 `Stamp: MINI_QCBASE`；角色需要 CLS 元数据读取，环境返回的旧日志主题可能已失效；创建返回 RequestId 不等于 Active。证书信息接口没有 PEM，只有签发后的详情接口用于指纹计算，详情响应的私钥不记录、不保存。完整回读、HMAC、临时凭证、账户归属和截图只留本机忽略目录。

本次没有后台业务写、微信上传、微信真机确认或支付验收；原后台发布记录中的原生健康探针权限阻塞仍保留。本次续期函数的真实 Invoke 与运行闭环已独立通过。后续日常部署及续期维护见 [mip-admin-release](../../../../.agents/skills/mip-admin-release/SKILL.md) 的[续期流程](../../../../.agents/skills/mip-admin-release/references/certificate-renewal.md)。
