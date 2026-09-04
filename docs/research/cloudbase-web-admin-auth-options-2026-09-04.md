# CloudBase Web 运营后台账号互通方案调研

> 调研日期：2026-09-04
>
> 范围：React Web 运营后台与现有微信小程序业务账号互通。只使用腾讯云开发 / 腾讯云、微信开放平台 / 微信公众平台官方文档及当前仓库源码。
>
> 边界：本文是选型研究，不代表目标环境已开通相关登录方式，也不修改代码或外部配置。本文不记录任何真实环境、应用、用户、电话号码或密钥值。

## 结论

推荐顺序如下：

1. **网页展示登录二维码，小程序扫码后确认**：作为目标主路径。二维码只携带高熵、短时、单次使用的挑战标识；小程序继续使用当前可信会话和运营 capability 完成确认，因此直接落到现有 MIP 业务账号，不新增第二套账号认领规则。
2. **保留现有 6 位码确认**：作为无摄像头、扫码失败和桌面端小程序等场景的兜底。它已经实现完整的账号与权限复核；二维码和短码上线前都应确认同一服务端链路在生产环境可用。
3. **短信验证码登录**：只作为恢复或备用入口。短信能证明号码控制权，但不能天然证明它对应当前 MIP 业务账号；必须显式、安全地绑定到既有 `mip_users.id`，且本仓库现行身份规范禁止登录时按号码自动认领或合并历史账号。
4. **微信开放平台网站应用扫码登录 / OAuth**：仅在网站应用已经通过审核、网站与小程序归属同一开放平台账号，并完成统一标识采集与历史账号映射时采用。否则会形成另一套微信身份，不能直接复用现有运营权限。
5. **CloudBase Web Auth 其他方式**：自定义 Ticket 最适合未来把 Web 会话统一迁入 CloudBase；邮箱、账号密码、通用 OAuth、OIDC/SAML 只适合有独立企业身份源的场景；匿名登录不适用于运营后台。

二维码方案改善的是输入体验和挑战熵，**不会绕过 CloudBase 云函数到 Web BFF 的网络与配置依赖**。若仍沿用现有确认端点，二维码与 6 位码共享相同的服务端确认链路；应持续验证链路可用性，再增加二维码入口。

## 当前 MIP 的账号事实

当前账号主键不是 CloudBase Web Auth UID，而是 MySQL 中的 `mip_users.id`。微信小程序可信身份在服务端摘要后写入 `mip_user_identities`，再映射到业务用户；管理员角色和 capability 也绑定到这个业务用户。数据库当前只允许 `WECHAT_MINIPROGRAM` 身份提供方，并仅保存用户标识和开放平台统一标识的摘要，不保存原文。[数据库基础迁移](../../database/mysql/mip/001_foundation.sql) · [数据合同](../data-contract.md)

当前网页登录链路为：

```text
浏览器向 Cloudflare BFF 申请挑战
  -> BFF 在 D1 保存 5 分钟单次挑战并设置 HttpOnly Cookie
  -> 已登录小程序输入 6 位码
  -> mip-admin-api 重新读取当前业务账号、角色和 capability
  -> CloudBase 云函数以独立 HMAC 请求 BFF 确认挑战
  -> 浏览器轮询并换取 8 小时 Web 会话
```

这条链路的账号互通是直接的：确认者就是当前小程序可信会话解析出的 MIP 用户，不需要另做号码或第三方账号匹配。当前实现还具备 5 分钟有效期、单次消费、浏览器 verifier、D1 原子确认、失败锁定和来源限制。[Web 架构](../../admin-web/ARCHITECTURE.md) · [确认客户端](../../cloudfunctions/mip-admin-api/lib/web-login-client.js) · [管理服务](../../cloudfunctions/mip-admin-api/domain/service.js)

CloudBase 官方所称“多种登录方式关联到同一个账号”，统一的是 **CloudBase UID**。只有完成身份源关联，不同方式才会登录到同一个 CloudBase 账号。[CloudBase 身份认证](https://docs.cloudbase.net/authentication-v2/auth/introduce) · [账户关联登录](https://docs.cloudbase.net/authentication-v2/auth/account-linking)

因此，直接在 React Web 中接入 CloudBase SMS/OAuth，只会先得到 CloudBase 用户身份，不会自动得到当前 `mip_users.id`、运营角色或 capability。上线任何 CloudBase Web Auth 方式前，都必须增加一条经过审计、可撤销、唯一约束的 `CloudBase UID -> mip_users.id` 映射，或把既有账号显式绑定到同一 CloudBase UID。

## 方案总表

| 顺序 | 方案 | 账号互通机制 | 主要前置条件 | 成本 / 配额 | 实现复杂度 | 安全性与限制 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 网页二维码 + 小程序扫码确认 | 继续使用小程序可信会话解析出的既有 MIP 用户；扫码只传递登录挑战 | 确认现有链路生产可用；新增二维码生成、扫码页和确认摘要 | 无短信费用；消耗现有函数、数据库和 BFF 资源 | 中 | 高熵、短时、单次挑战；需防二维码替换、诱导确认和重放 |
| 2 | 现有 6 位码确认 | 与当前业务账号直接互通；服务端再次检查角色和 capability | BFF/D1、确认端点、双方用途隔离的服务器签名配置均可用 | 无短信费用；消耗现有函数、D1 和网络请求 | 低，已实现 | 6 位码熵低，必须依赖短 TTL、单次消费、浏览器绑定和限流；手工输入易错 |
| 3 | 短信验证码 | 验证号码后，显式查找已绑定且唯一的业务账号；不能自动合并 | 上海地域；CloudBase 开启短信登录；建立受审计的既有账号绑定/恢复流程 | 预付费环境首月 100 条免费；超出购买短信资源包；同号默认 30 秒 1 条、每天 30 条 | 中到高 | 有短信轰炸、号码回收、SIM 换卡风险；只能作为备用，并仍须检查运营权限 |
| 4 | 微信网站应用 OAuth | 通过同一开放平台账号下的统一标识，把网站微信身份映射到既有 MIP 用户 | 已审核网站应用和微信登录能力；同一开放平台绑定；HTTPS 回调域名；历史身份映射 | 无官方按次登录费说明；会消耗 CloudBase/BFF 常规资源；有申请审核和维护成本 | 高 | 标准 OAuth，需校验 state、一次性 code、服务端保存凭证；用户切换微信账号会映射到不同业务用户 |
| 5 | CloudBase Web Auth 其他方式 | 显式绑定到同一 CloudBase UID，再映射到既有 MIP 用户；自定义 Ticket 可由服务端指定稳定身份 | 开启对应身份源；Web 安全域名；Ticket 需服务端私钥；OIDC/SAML 需企业 IdP | 官方未列普通认证的独立按次价格；函数、数据库和流量按套餐/资源点计量 | 中到高 | 邮箱/密码/第三方 OAuth 都不是现有小程序账号；匿名不适用；身份绑定和解绑必须可审计 |

CloudBase 资源点模式的官方基准为 1000 点对应 1 元，免费体验环境当前为每月 3000 点，但免费环境不支持加购资源包或按量付费，并存在功能限制。[资源点价格文档](https://cloud.tencent.com/document/product/876/127357) 普通身份认证没有公开的统一“每次登录价格”，应以目标环境套餐、控制台可用能力和实际资源消耗为准。

## 1. 短信验证码登录

### 账号互通

CloudBase SMS 登录会创建或登录 CloudBase 用户。它只有在号码身份已关联到同一个 CloudBase UID 时，才能与其他 CloudBase 登录方式共享 UID。[CloudBase 身份认证](https://docs.cloudbase.net/authentication-v2/auth/introduce) · [账户关联登录](https://docs.cloudbase.net/authentication-v2/auth/account-linking)

对当前 MIP，号码已经作为加密私有资料绑定在 `mip_private_profiles`，业务用户仍由 `mip_users.id` 持有。本仓库明确规定：没有可验证的统一身份数据时，不提供按号码自动认领或合并历史账号；号码只能用于当前账号的服务端验证与绑定。[身份迁移规范](../IDENTITY_MIGRATION.md)

因此可接受的实现只有两类：

- 用户已在小程序可信会话内，主动把 CloudBase SMS 身份绑定到当前 MIP 用户；
- 运营恢复流程同时验证短信、既有强凭证或人工审核，再建立唯一映射。

仅凭“收到短信”直接寻找同号码用户并签发管理会话，不符合当前身份规范，也放大号码回收和换卡风险。

### 前置条件、费用和配额

- CloudBase 官方当前文档标注 SMS 登录仅支持上海地域，使用前必须在身份认证中开启对应登录方式。
- 预付费环境首月提供 100 条免费短信；超出后购买 CloudBase 短信资源包，或配置自定义短信通道。
- 默认同一号码 30 秒内最多 1 条、每天最多 30 条；每日上限可在控制台调整。

来源：[CloudBase 短信验证码登录](https://docs.cloudbase.net/authentication-v2/method/sms-login)

### 安全与限制

- 发送、验证、失败次数、来源 IP 和账号恢复都要限流；运营权限必须在登录成功后重新从服务端读取。
- 不在浏览器、日志或审计 metadata 中记录完整号码和验证码。
- 不把 SMS 当作高权限管理员的唯一长期凭证；可作为二维码/短码不可用时的恢复入口。

## 2. 当前小程序内 6 位码确认

### 账号互通

这是当前唯一不需要身份迁移的方案。`mip-admin-api` 从 CloudBase 可信上下文取得小程序调用者，先执行当前 session/capability 检查，再把挑战确认发送给 Web BFF。[管理服务确认逻辑](../../cloudfunctions/mip-admin-api/domain/service.js) · [可信身份解析](../../cloudfunctions/mip-admin-api/lib/identity.js)

### 前置条件、成本和复杂度

- Cloudflare Pages/Worker、D1 迁移、同源 Cookie 和允许来源必须正常。
- CloudBase 管理函数必须能通过 HTTPS 访问 BFF 内部确认端点。
- CloudBase 与 BFF 必须配置同一登录确认签名值，且与管理请求签名、Web 会话密封值分域。
- 没有短信按条费用；成本来自一次 CloudBase 函数执行、一次跨网络确认、D1 读写和浏览器轮询。
- 仓库已经实现，复杂度最低；当前“确认成功但网页仍等待”或“服务暂时不可用”属于部署/运行链路问题，不是增加另一种账号登录方式就能自动消除的问题。

### 安全与限制

现有实现使用 5 分钟有效的 6 位数字单次码、浏览器 verifier、`HttpOnly` 会话、D1 原子确认、每账号失败锁定和每 IP 创建限流。[Web 架构](../../admin-web/ARCHITECTURE.md)

短码只有约 20 bit 熵，不能脱离这些保护单独使用。还应继续保持：

- 码只在 HTTPS 页面展示，不进入 URL、日志和分析事件；
- 成功、过期或刷新页面后立即失效；
- 小程序确认页展示登录域名和有效期，避免用户确认不认识的请求；
- 网页必须轮询同一个浏览器挑战 Cookie，不能只凭数字码换会话。

## 3. 网页二维码后小程序扫码确认

### 推荐实现

网页生成至少 128 bit 随机挑战，将版本、挑战标识和校验信息编码为二维码。用户在已经登录的小程序运营工作台中调用 `wx.scanCode`，解析并展示登录域名、创建时间和设备摘要，用户显式确认后，由现有 `mip-admin-api` 完成账号、角色与 capability 复核，再确认 Web 挑战。微信官方 `wx.scanCode` 可以调起客户端扫码并返回二维码内容。[微信小程序扫码 API](https://developers.weixin.qq.com/miniprogram/dev/api/device/scan/wx.scanCode.html)

二维码不得包含业务用户标识、角色、会话令牌或任何服务器凭证。扫描结果只是一份不可预测、短时、单次挑战；服务端仍以小程序可信上下文决定确认者身份。

### 前置条件、成本和复杂度

- 持续验证现有 CloudBase 到 BFF 确认链路；复用原链路时，二维码不会绕过它。
- Web 增加二维码渲染与状态轮询，小程序增加扫码、解析、确认和错误状态；BFF 将挑战从 6 位码升级为高熵标识，同时保留 6 位码索引作为兜底。
- 无短信按条费用；消耗与当前短码方案同类的函数、D1/数据库和网络资源。
- CloudBase Cloud API 当前还列出了“微信小程序扫码登录”认证源，并规定每个环境最多可加入 20 个认证源。[添加第三方认证源](https://cloud.tencent.com/document/api/876/129357) 但公开 API 文档只证明该认证源类型存在，没有给出当前 MIP 可直接采用的完整控制台接入、账号迁移和会话适配步骤。采用该原生认证源前必须做独立预发布 PoC，不能把枚举存在当作已经可用。

### 安全与限制

- 高熵挑战优于 6 位码抵抗枚举，但仍须短 TTL、单次消费、浏览器绑定、确认端限流和服务端签名。
- 防止“登录二维码钓鱼”：小程序确认页必须显示可信域名、请求时间和设备摘要，不扫描后自动确认。
- 防止二维码替换：挑战内容需要版本和完整性校验，服务端只接受本域创建且仍处于待确认状态的挑战。
- 桌面没有摄像头、权限被拒绝或扫码 API 不可用时，保留 6 位码入口。

## 4. 微信开放平台网站应用扫码登录 / OAuth

### 账号互通

网站应用微信登录基于 OAuth 2.0。微信官方说明：网站应用、小程序等只有归属同一个微信开放平台账号时，同一用户才拥有可用于跨应用识别的统一标识。[网站应用微信登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) · [UnionID 机制说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/union-id.html)

CloudBase 官方微信登录文档要求先配置微信开放平台登录。首次登录若没有关联用户，登录会返回未找到；需要先以其他方式注册，再把微信身份绑定到该 CloudBase 用户，后续才能登录到同一 UID。[CloudBase 微信授权登录](https://docs.cloudbase.net/authentication-v2/method/wechat-login)

对当前 MIP，这仍不足以直接取得业务账号：

- 当前数据库只允许小程序身份提供方；需要新增网站微信身份或 CloudBase UID 的映射合同和迁移。
- 只有现有账号已经采集统一标识摘要、网站和小程序同属一个开放平台账号时，才有自动匹配的可信基础。
- 历史账号没有统一标识时，必须通过已登录小程序绑定或人工核验，不能按昵称、头像或号码自动合并。

### 前置条件、成本和复杂度

- 注册微信开放平台开发者账号，创建并审核通过网站应用，再申请微信登录能力。
- 配置 HTTPS 授权回调域名；回调域名必须与审核信息一致。
- 在 CloudBase 启用微信开放平台身份源，并把 Web 域名加入安全来源。
- 需要服务端安全保存网站应用凭证、处理 OAuth 回调和业务账号映射；审核、变更和迁移成本高于当前小程序确认方案。
- 官方没有列出按次登录费用；常规 CloudBase/BFF 资源仍按套餐或资源点消耗。

### 安全与限制

微信官方要求授权 `code` 只有 10 分钟有效且只能成功使用一次，并建议使用 HTTPS 与 `state` 防止 CSRF。[网站应用微信登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)

浏览器只能接收短时回调参数；网站应用凭证和换取 token 的过程留在服务端。用户在网页扫码时可以切换微信账号，因此登录后仍必须映射到业务用户并重新检查运营 capability。

## 5. CloudBase Web Auth 的其他可用方式

CloudBase 当前身份认证总览列出匿名、用户名密码、短信、邮箱、微信、自定义和小程序登录，并要求每种方式先在身份认证中启用。[身份认证总览](https://docs.cloudbase.net/authentication-v2/auth/introduce) Web SDK v3 进一步提供密码登录、邮箱/短信 OTP、第三方 OAuth、自定义 Ticket、匿名登录及身份源关联；小程序静默登录和小程序号码授权明确只支持小程序端，不能直接在普通 React Web 页面调用。[Web SDK v3 身份认证 API](https://docs.cloudbase.net/api-reference/webv3/authentication)

### 自定义 Ticket

这是未来把 Web 会话统一迁入 CloudBase Auth 时最匹配当前 MIP 的方式：服务端在完成小程序扫码/短码确认后，为已确认业务用户签发短时 Ticket，React Web 用 Ticket 建立 CloudBase 会话。

限制：

- Ticket 私钥只能保存在云函数、云托管或受控服务器，不能进入 React、小程序、仓库或日志。
- 官方自定义身份 ID 只允许 4–32 个字符，而当前 MIP 用户主键为 36 字符；不能直接照搬，需要稳定、不可逆的 32 字符别名或独立映射，并保留唯一约束。
- 重新生成自定义登录私钥后，旧私钥将在 2 小时后失效；需要明确轮换流程。
- 第一次自定义登录会自动创建 CloudBase 用户，但运营角色仍以 MIP 服务端事实为准。

来源：[CloudBase 自定义登录](https://docs.cloudbase.net/authentication-v2/method/custom-login)

### 邮箱 OTP、账号密码和通用 OAuth

- 邮箱验证码支持 CloudBase 内置邮件服务，也可配置自定义 SMTP；适合作为企业邮箱恢复方式，但必须先绑定到当前业务账号。[邮箱验证码登录](https://docs.cloudbase.net/authentication-v2/method/email-login)
- 用户名、邮箱或号码加密码属于独立凭证体系；会引入注册、重置、撞库防护和客服恢复成本，不建议为当前小规模运营后台新建。
- Google、GitHub、Apple 等 OAuth，以及 OIDC/SAML，适合已有企业 IdP 的组织；都必须显式绑定到同一 CloudBase UID，再映射到 MIP 用户。CloudBase Cloud API 的身份源类型还包括 OAuth、OIDC、SAML、微信公众号、微信开放平台和企业微信等；一个环境最多 20 个认证源。[添加第三方认证源](https://cloud.tencent.com/document/api/876/129357)
- 匿名登录清除本地状态后无法可靠追溯，不具备运营后台所需的可问责身份，不采用。[用户管理](https://docs.cloudbase.net/authentication-v2/auth/manage-users)

### Web 安全域名和会话

使用 CloudBase Web Auth 时，线上域名和 OAuth 回调域名必须进入 CloudBase 安全来源。官方当前限制为每个环境最多 50 个安全域名，修改约 1–2 分钟生效。[安全来源](https://docs.cloudbase.net/envconfig/security/intro)

CloudBase 默认访问令牌有效 2 小时、刷新令牌 30 天、最大会话数 1，可配置范围分别为 1–24 小时、1 小时至 30 天和 1–100。官方对管理类应用建议缩短访问令牌并限制会话数。[Token 管理](https://docs.cloudbase.net/authentication-v2/auth/token)

## 推荐落地顺序

### 第一阶段：确认并保留现有短码

先验证当前 6 位码链路的生产可用性，包括 BFF/D1、确认端点、签名配置、允许来源和 CloudBase 出网。保持现有账号、权限和审计模型不变。短码作为长期兜底保留。

### 第二阶段：在同一挑战合同上增加二维码

把高熵挑战作为主标识，Web 同时展示二维码和 6 位备用码；小程序扫码后显示明确确认页，再沿用同一个 `mip-admin-api` capability 复核和审计。这样只改善挑战传递方式，不改变“谁可以登录”的服务端事实。

### 第三阶段：增加受控恢复方式

若确实需要脱离小程序恢复登录，再接 SMS。首次绑定必须在已经可信登录的小程序会话内完成；无法进入小程序时走人工核验，不开放按号码自动认领。SMS 登录后仍按 `mip_users.id` 读取角色和 capability。

### 条件阶段：评估 CloudBase Auth 统一会话

只有在决定把 Web 会话和身份源统一迁入 CloudBase 时，才评估自定义 Ticket 或官方小程序扫码认证源。迁移前必须先建立 `CloudBase UID -> mip_users.id` 一对一合同、解绑/关闭/审计规则和预发布 PoC。网站微信 OAuth 只在网站应用审核与同开放平台统一标识条件已经具备时进入评估。

## 上线安全门禁

- 任何 Web 登录结果都只建立“认证主体”，运营角色、scope 和 capability 每次由 MIP 服务端重新读取。
- 所有挑战短时、单次、不可预测，绑定浏览器上下文；二维码和短码不进入 URL、持久化存储或日志。
- 二维码确认页显示可信域名、时间和设备摘要，禁止扫描后自动确认。
- 所有身份绑定、解绑、恢复和冲突都写审计；唯一性冲突失败关闭，不自动合并账号。
- 浏览器不接触第三方应用凭证、自定义 Ticket 私钥、BFF 签名值或 MySQL 连接信息。
- SMS、OAuth、Ticket 和扫码都需验证失败限流、重放、过期、跨浏览器消费、账号关闭、权限撤销和会话注销。
- 生产结论必须分别给出本地测试、预发布运行、CloudBase 配置回读、Cloudflare/D1 状态和真机扫码证据；本文没有提供这些运行证据。
