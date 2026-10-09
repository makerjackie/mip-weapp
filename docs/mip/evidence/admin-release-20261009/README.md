# 2026-10-09 CloudBase 管理后台发布

本轮为已有 staging 后台拉取、发布与读取验收。代码从 `3350cc6a` fast-forward 到 `bc0a6897`；运行修复提交为 `d4d0ef17`、`d69d9b73`，最终运行源码 `d69d9b7336e2f41cd3a21d62e0449911f291b38f`，已回读远端 main 一致。本证据之后的文档提交不改变运行代码。

## 发布与版本证明

- 页面根路径来自独立静态前缀 `mip-admin-console/`；所属 `/api`、`/assets` 指向 `mip-admin-web-api`，业务操作继续调用 `mip-admin-api`。HTTP 网关与其他共享资源没有改动。
- 初查首页引用的哈希 JS 在 BFF 内不存在，返回 404/白屏。两份产物已同步；最终入口 `/assets/index-CYFT5GuB.js`，14 个当前静态文件的 HTTPS 字节 SHA-256 与构建一致。
- BFF 发布时保留上一版本不可变哈希资源，先更新 BFF，再更新静态入口。它的 17 个文件逐一与下载代码包一致；管理 API 的 163 个运行 JS/JSON 文件逐一与源码一致。两份 ZIP 自身的 SHA-256 与 SCF 元数据一致，见 [release.json](release.json)。
- 保留角色、VPC、运行时、超时、内存和公网配置，回读零定时器；SDK 权限维持后台 BFF 禁止客户端调用、管理 API 仅允许已认证调用。环境变化仅为 BFF 代码摘要、管理 API 的 CloudBase 登录分流回调及 staging QR `trial` 配置。
- 用户最初提供的测试域名缺少 `cloud1-`，实测 404 `INVALID_ENV`；本轮使用本机已配置的完整 CloudBase origin，实测 200。首访可能显示 CloudBase 自身的测试域名提示。验收文档不保存环境 ID 或凭证。

## 修复与验证

首次真实 HTTPS 验收有 1 个失败：入会审核请求发送 `filters.query`，服务端不接受；界面还从错误层级读取用户昵称。已统一搜索、状态枚举及嵌套用户 DTO，并补非空服务端结构到页面展示的合同测试。

追加的真实中文搜索发现昵称被比较到 `ascii_bin` 用户 ID 列，造成数据库字符集转换失败。姓名查询只比较 UTF-8 昵称；合法 UUID 才追加 ID 谓词，保留应用范围、分页前筛选及 LIKE 字面量转义。管理 API 更新后真实非空记录、中文昵称加实际状态搜索、无匹配空结果全部通过。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| Node 22.23.1 / pnpm 11.14.0 完整 `pnpm verify:all` | PASS | 本地测试、合同、lint、类型、构建、预算及响应式源契约 |
| ZIP / 运行源码 / HTTPS 静态哈希 | PASS | API 163 文件、BFF 17 文件、当前公开静态 14 文件 |
| 真实密码认证、Cookie、来源防护、14 个读模块、退出 | 67/67 PASS | [https.json](https.json)；没有业务写入 |
| 审核非空 DTO 到页面、中文状态搜索、空结果 | 3/3 PASS | [approvals.json](approvals.json)；不记录账号或业务字段值 |
| 浏览器实际渲染 | PASS | 真实概览和入会审核列表/中文筛选；入口 JS 与发布一致 |
| 浏览器视口 | PASS | 1440×900、1280×720、390×844；无页面横向溢出；临时视口已恢复 |
| 原生 `manageFunctions invokeFunction` 健康探针 | BLOCKED | API Key 被 CAM 拒绝；既有本机缓存授权未能续期；没有扩大权限 |

`pnpm cloud:deploy -- --only=mip-admin-api` 在代码与配置上传、Active 回读之后因上述健康探针退出失败，因此**不将该命令本身记作成功**。本轮随后独立完成代码包、配置、SDK 权限、定时器回读，并验证真实认证 HTTP 请求到非空 MySQL 业务查询；这些是本轮运行证据，不能将其改写为原生健康探针通过。

## Cloudflare 与验收边界

- 完整 CloudBase origin 的页面、API 和静态资源由 CloudBase 服务。
- `mipadmin.01mvp.com` 仍由 Cloudflare 返回 302 到 CloudBase；`mipmini.01mvp.com` 旧站仍在 Cloudflare 返回 200。未修改 DNS、删除或关停旧资源。
- 登录分流回调已配置并回读，微信真机输入确认码/扫码确认没有执行。
- 没有微信代码上传、支付、退款、授予权益、群发、素材上传或业务编辑；本轮不是全业务/全角色/生产支付验收。支付仍为 TEST。
- 发布前函数 ZIP、完整配置、部署日志及浏览器截图保存在被忽略的 `.tmp/admin-release-20261009/`；入库报告只保留数量、哈希及边界，不保存凭证、会话、环境 ID 或个人资料。
