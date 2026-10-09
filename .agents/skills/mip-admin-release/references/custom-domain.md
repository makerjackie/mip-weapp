# 管理后台自定义域名

适用于把用户指定的子域名接入已有 CloudBase 后台。沿用已验证的运行包，不因为绑域名再次部署无关函数、上传小程序或关闭旧平台。

## 保存与准备

1. 回读 DNS 当前记录、CloudBase `queryGateway(listCustomDomains/listRoutes)`、BFF 完整 SCF 配置及安全域名。仅修改目标子域名，保留根域、泛解析、邮件和其他子域名。
2. 核对目标环境和现有 `/`、`/api`、`/assets` 路由。自定义域名使用 HTTP 网关，不能只绑定静态托管，否则同源 BFF 不工作。
3. 用 `VerifyHTTPServiceRoute` 或 `manageGateway(bindCustomDomain)` 的实际返回定位域名归属 TXT，不能凭历史环境 ID 猜记录。优先只验证目标子域名。
4. 无匹配证书时，在腾讯云 SSL 控制台为该子域名申请证书，按实际要求添加 DNS 验证记录；不要打印、下载入库或共享私钥。免费证书有效期短，完成后回读实际到期日并说明续期需求。若工具规则要求用户确认协议或接管敏感步骤，先准备具体表单再请求。

**预检的 `Cert: PASS` 不证明证书已签发或 TLS 能用。** 未签发的证书可能通过预检，但正式创建仍报 `certificate[...] content invalid`，并留下 `Status=FAIL`、无 CNAME/路由的部分绑定。等待证书控制台显示已签发，再绑定并实际验证 HTTPS。失败后先回读，不假定没有副作用；仅在确认是本次创建、无流量、无 CNAME/路由的失败记录时，保存回读后移除该失败绑定并重建。不得套用到已有正常域名。

## 绑定网关与登录来源

1. 使用 `DIRECT`，按用户需求设置 `HTTP_TO_HTTPS`。不要默认购买 CDN、切换接入方式或使用旧服务器反代。
2. 将默认后台的三个已审查路由复制到目标域名，保留安全域名验证、路径透传和其他路由属性：

   | 路径 | 上游 | 必须保留 |
   | --- | --- | --- |
   | `/` | `STATIC_STORE/staticstore` | `PathRewrite.StaticStorePrefix=/mip-admin-console` |
   | `/api` | `SCF/mip-admin-web-api` | `EnablePathTransmission=true` |
   | `/assets` | `SCF/mip-admin-web-api` | `EnablePathTransmission=true`，缺失哈希资源返回 404 |

   只复制这三个路径，不额外暴露核心函数入口。对新增域名先 `VerifyHTTPServiceRoute`，通过后 `CreateHTTPServiceRoute`；已有目标域名先比较回读再决定修改。完整回读目标域名与旧域名，证书、协议、路由必须一致且旧入口保持原配置。
3. 在 BFF 的 `MIP_WEB_ADDITIONAL_ORIGINS` 追加目标 `https://host`，保留原 origin 和已有追加值；同步到本机 `.env.local`，避免下次发布覆盖。SCF 配置更新使用仓库 `core-function-config-update` 守卫及完整环境变量，不改代码、角色、网络、内存或运行时。不得取消 Origin 校验。
4. 用 `queryEnv(domains)` 确认目标 host 未存在后，`envDomainManagement(create)` 只追加该 host；回读 `ENABLE`。平台安全域名与 BFF 的 Origin 允许列表是两个配置项。
5. 以平台创建后返回的 `Cname` 为 DNS 目标，添加精确子域名 CNAME；不要猜目标或用重定向记录代替绑定。先确保目标证书与路由就绪，再切换 DNS。用权威 DNS 和递归 DNS 分别回读，预留旧缓存传播时间。

`MIP_ADMIN_WEB_CLOUDBASE_ORIGIN` 仍是默认网关发布目标；绑定自定义域名不会更改微信 challenge 的稳定回调地址，也不自动证明微信真机确认成功。

## 验证与留证

- 验证 TLS 证书的主机名、有效期和信任链，不能以忽略证书错误完成验收。验证 HTTP 到 HTTPS 跳转。
- 回读网关 `Status`、`DNSStatus`、证书关联和三条路由；确认 CNAME 来自本次平台回读。
- 使用当前静态发布清单，核对新域名 HTML 与全部文件 SHA-256、大小、MIME 和入口 JS。`verify-admin-live-assets` CLI 的 origin 守卫读取本机配置；对已单独回读证明绑定的自定义域名，可仅为这次只读命令设置进程级 `MIP_ADMIN_WEB_CLOUDBASE_ORIGIN=<已验证origin>`，不更改部署脚本的默认目标。
- 真实验证同源密码登录、Secure/HttpOnly/SameSite Cookie、来源拒绝、非空读取、退出和会话重放拒绝。现有 HTTPS 验证器要求 origin 与其私有部署 target 一致；新域名必须有独立的已绑定 target 证据，不覆盖旧 target 来绕过守卫。保留同样的只读 contract allowlist 和脱敏报告。
- 在新网址实际渲染并登录，确认加载的入口 JS、真实数据、桌面与手机视口；截图仅保存在本机忽略目录。完成后恢复视口。
- 把域名、实际证书到期日、运行包对应关系和完成/阻塞状态记录到当前状态与证据目录。CA 审核、备案或 DNS 缓存尚未完成时明确写 `PENDING`，不宣布绑定成功。

参考：[CloudBase 自定义域名](https://docs.cloudbase.net/service/custom-domain)、[腾讯云证书控制台](https://console.cloud.tencent.com/ssl)。
