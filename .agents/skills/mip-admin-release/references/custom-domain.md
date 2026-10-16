# 管理后台自定义域名

适用于把用户指定的子域名接入已有 CloudBase 后台。沿用已验证的运行包，不因为绑域名再次部署无关函数、上传小程序或关闭旧平台。

## DNS 归属与目标选择

`mip.cool` 的域名管理与权威 DNS 均在**阿里云**，解析入口为 [mip.cool 解析控制台](https://dnsnext.console.aliyun.com/authoritative/domains/mip.cool)。证书在腾讯云 SSL，服务在 CloudBase HTTP 网关；不要去 DNSPod、Cloudflare 或旧服务器增加解析。执行前回读 NS，确认归属没有变化。

两套后台可以共享同一个 CloudBase EnvID，但必须按域名选择各自资源：

| 入口 | 静态前缀 | `/api`、`/assets` 上游 | 认证 schema |
| --- | --- | --- | --- |
| `admin.mip.cool` | `mip-admin-console/` | `mip-admin-web-api` | `mip_admin_auth` |
| `test.admin.mip.cool` | `mip-admin-console-test/` | `mip-t-admin-web-api` | `mip_test_admin_auth` |

这张表用于识别边界，实际操作仍以目标配置与云端回读一致为准。测试配置可能位于独立 worktree 的 `envs/test/`，不能把当前 checkout 的默认配置或默认网关路由当成测试目标。记录实际 checkout、提交及私有部署 target，保留并行未提交改动。

多级域名需要准确匹配的证书：`admin.mip.cool` 的单域名证书以及 `*.mip.cool` 都不覆盖 `test.admin.mip.cool`。已存在 CNAME 时比较平台回读目标，吻合则保留，不重复创建。

## 保存与准备

1. 回读 DNS 当前记录、CloudBase `queryGateway(listCustomDomains/listRoutes)`、BFF 完整 SCF 配置及安全域名。仅修改目标子域名，保留根域、泛解析、邮件和其他子域名。
2. 核对目标环境和现有 `/`、`/api`、`/assets` 路由。自定义域名使用 HTTP 网关，不能只绑定静态托管，否则同源 BFF 不工作。
3. 用 `VerifyHTTPServiceRoute` 或 `manageGateway(bindCustomDomain)` 的实际返回定位域名归属 TXT，不能凭历史环境 ID 猜记录。优先只验证目标子域名。
4. 无匹配证书时，在腾讯云 SSL 控制台为该子域名申请证书，按实际要求添加 DNS 验证记录；不要打印、下载入库或共享私钥。免费证书有效期短，完成后回读实际到期日并说明续期需求。若工具规则要求用户确认协议或接管敏感步骤，先准备具体表单再请求。

### 阿里云 DNS 验证

先检查 SSL 列表里是否已有该域名的待签发订单，超时或结果不明时复用原订单，不重复申请占用额度。环境 API Key 能操作网关不代表有账号级 SSL 权限；SSL 返回 UnauthorizedOperation 时，可以使用已有权限的官方工具或已登录的腾讯云控制台，不因此给日常 Key 扩权。

在腾讯云选择免费单域名证书、**手动 DNS 验证**（阿里云解析不适用腾讯云自动 DNS），提交后读取本次实际 TXT 主机名和值。比如完整名 `_dnsauth.test.admin.mip.cool` 在阿里云 `mip.cool` 区域填写 `_dnsauth.test.admin`；不要再拼一次根域或修改同名 CNAME。CloudBase 的归属验证 TXT 与 SSL 的验证 TXT 分别来自各自实际返回，不能互相代用。

阿里云添加记录后还可能弹出“解析变更确认”；检查只有本次 TXT 后提交，并回读列表中记录类型、值、启用状态和 TTL。若 AX 树未显示这个弹窗，先取新截图再操作可见按钮，不能重复点后方保存按钮。保存和 CA 验证是两个步骤：在腾讯云原订单执行“验证域名”，等待 CA 签发。权威/递归 DNS 分别留证；本机代理可能返回 `198.18.0.0/15` fake IP 或干扰 TXT，必要时用可信公共 DNS 的 HTTPS 查询交叉验证，不改根域 NS，也不关闭 TLS 校验。

**预检的 `Cert: PASS` 不证明证书已签发或 TLS 能用。** 未签发的证书可能通过预检，但正式创建仍报 `certificate[...] content invalid`，并留下 `Status=FAIL`、无 CNAME/路由的部分绑定。等待证书控制台显示已签发，再绑定并实际验证 HTTPS。失败后先回读，不假定没有副作用；仅在确认是本次创建、无流量、无 CNAME/路由的失败记录时，保存回读后移除该失败绑定并重建。不得套用到已有正常域名。

## 绑定网关与登录来源

1. 使用 `DIRECT`，按用户需求设置 `HTTP_TO_HTTPS`。不要默认购买 CDN、切换接入方式或使用旧服务器反代。
2. 新域名按上面的目标表配置三个已审查路由，保留安全域名验证、路径透传和其他路由属性。下面是正式后台示例，测试后台必须换成测试前缀及测试 BFF：

   | 路径 | 上游 | 必须保留 |
   | --- | --- | --- |
   | `/` | `STATIC_STORE/staticstore` | `PathRewrite.StaticStorePrefix=/mip-admin-console` |
   | `/api` | `SCF/mip-admin-web-api` | `EnablePathTransmission=true` |
   | `/assets` | `SCF/mip-admin-web-api` | `EnablePathTransmission=true`，缺失哈希资源返回 404 |

   只复制这三个路径，不额外暴露核心函数入口。对新增域名先 `VerifyHTTPServiceRoute`，通过后 `CreateHTTPServiceRoute`；已有目标域名先比较回读再决定修改。**已有正确路由而仅缺证书时**，`ModifyHTTPServiceRoute` 只提交 `{EnvId, Domain: {Domain: host, CertId: issuedId, Protocol: 'HTTP_TO_HTTPS'}}`，不发送其他域名或重建路由。回读目标证书、协议、全部路由，并逐项比较其他域名没有变化。最小修改不替代变更前快照与变更后断言。
3. 比较目标 BFF 的 `MIP_WEB_ALLOWED_ORIGIN` 和 `MIP_WEB_ADDITIONAL_ORIGINS`；已允许该 origin 时保留。给同一后台加别名才追加 `MIP_WEB_ADDITIONAL_ORIGINS`；独立测试 BFF 的主 origin 应为测试域名，不能为方便登录而跨环境放行。同步目标配置目录，避免下次发布覆盖。SCF 配置更新使用仓库 `core-function-config-update` 守卫及完整环境变量，不改代码、角色、网络、内存或运行时。不得取消 Origin 校验。
4. 用 `queryEnv(domains)` 确认目标 host 未存在后，`envDomainManagement(create)` 只追加该 host；回读 `ENABLE`。平台安全域名与 BFF 的 Origin 允许列表是两个配置项。
5. 以平台创建后返回的 `Cname` 为 DNS 目标，添加精确子域名 CNAME；不要猜目标或用重定向记录代替绑定。先确保目标证书与路由就绪，再切换 DNS。用权威 DNS 和递归 DNS 分别回读，预留旧缓存传播时间。

正式后台已有默认网关发布目标时保留它。独立测试后台若部署脚本及 private target 已明确选择测试域名，则沿用该测试目标，不改成正式默认网关。若本次同时调整 challenge 回调，核对目标配置目录的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` / `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 及目标 admin-api 回读，保留正式后台与旧站各自的回调分流；仅改云端会被后续部署覆盖。绑定域名或回读配置不证明微信确认成功。

## 验证与留证

- 验证 TLS 证书的主机名、有效期和信任链，不能以忽略证书错误完成验收。验证 HTTP 到 HTTPS 跳转。
- 回读网关 `Status`、`DNSStatus`、证书关联和三条路由；确认 CNAME 来自本次平台回读。
- 使用目标后台当前静态发布清单，核对新域名 HTML 与全部文件 SHA-256、大小、MIME 和入口 JS。`verify-admin-live-assets` 的 origin 守卫读取本机配置，目录守卫从 `MIP_ADMIN_CONSOLE_PREFIX` 派生（默认正式目录），测试清单必须明确选择 `mip-admin-console-test`，不能篡改清单 prefix 让校验通过。对已单独回读证明绑定的自定义域名，可仅为这次只读命令设置进程级目标变量，不更改另一套后台的默认配置。若参数化部署尚在另一 worktree，使用其真实清单与配置，记录源码提交和本地改动边界。
- 真实验证同源密码登录、Secure/HttpOnly/SameSite Cookie、来源拒绝、非空读取、退出和会话重放拒绝。现有 HTTPS 验证器要求 origin 与其私有部署 target 一致；新域名必须有独立的已绑定 target 证据，不覆盖旧 target 来绕过守卫。保留同样的只读 contract allowlist 和脱敏报告。
- 在新网址实际渲染并登录，确认加载的入口 JS、真实数据、桌面与手机视口；记录实际 `innerWidth/innerHeight`，不能只记录视口设置参数（浏览器缩放会影响 CSS 尺寸）。截图仅保存在本机忽略目录。完成后恢复视口。
- 把域名、实际证书到期日、运行包对应关系和完成/阻塞状态记录到当前状态与证据目录。CA 审核、备案或 DNS 缓存尚未完成时明确写 `PENDING`，不宣布绑定成功。
- 首次签发与自动续期分别验收。正式后台现有续期任务默认只处理 `admin.mip.cool`，不能声称新测试域名也已自动续期；需要时按续期流程单独审查目标域名、前缀、BFF 与角色权限，并验证云端任务。不要挪用正式任务或自动扩大它的权限。

参考：[CloudBase 自定义域名](https://docs.cloudbase.net/service/custom-domain)、[腾讯云证书控制台](https://console.cloud.tencent.com/ssl)。
