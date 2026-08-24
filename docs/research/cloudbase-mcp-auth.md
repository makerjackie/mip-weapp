# CloudBase MCP 云函数部署鉴权调查

> 调查日期：2026-08-24
> 范围：CloudBase MCP `2.23.11`、环境级 CloudBase API Key、SCF `CreateFunction`、`TCB_QcsRole` 与 VPC。文末追加了 MCP `2.32.0` 与资源主账号 Device Flow 的实际部署结果。

## 结论

先前“给 `TCB_QcsRole` 增加 `scf:CreateFunction`”的解释把两个身份混在了一起。`manageFunctions(action="createFunction")` 的实际调用链是：

```text
CloudBase API Key
  -> /capi/credential 换取环境级临时 STS 密钥
  -> CloudBase MCP 用临时密钥初始化 Manager SDK
  -> Manager SDK 直接调用 scf.tencentcloudapi.com / CreateFunction
  -> 新函数的 Role 参数设为 TCB_QcsRole
```

因此：

- `you are not authorized to perform operation (scf:CreateFunction)` 拒绝的是第一条身份链中的临时 STS 调用者，不是函数将来使用的 `TCB_QcsRole`。
- 腾讯官方 MCP 明确把环境级 API Key 推荐给 CI/CD、MCP Server 和 AI Agent；MCP 源码也确实用它换取临时 STS 密钥，再执行 `manageFunctions/createFunction`。正常情况下不应要求用户再给 API Key 配一套 CAM 子账号策略。
- 腾讯云官方对 `api_key` 的定义是环境级服务端管理员凭证，宣称拥有数据库、云函数、云存储、托管等环境资源的完整访问与操作权限。当前临时 STS 密钥仍被 SCF 拒绝，与这个官方合同不一致；优先应检查 API Key 类型、环境/地域、旧凭证缓存和 MCP 版本，仍复现则应按 CloudBase 凭证下发或环境归属问题提交腾讯云工单，而不是先扩大 `TCB_QcsRole`。
- 但腾讯官方当前资料存在口径冲突：最新版 MCP 源码对管控面 CAM 错误明确提示“常见于 API Key 登录仅授权数据面”，首选改用 Device Code 登录管控面，第二选择才是有相应 CAM 策略的腾讯云 `SecretId/SecretKey`。因此，环境 API Key 是否应覆盖原始 `scf:CreateFunction` 不能仅凭公开文档下定论；对当前个人本地部署，Device Flow 是官方给出的最小、最安全绕行方式。
- 当前仓库只有首个 `CreateFunction` 的 `scf:CreateFunction` 拒绝证据。请求在权限检查阶段已经失败，仓库没有保存一条独立的 VPC/子网原始错误，因此目前不能确认“还缺目标 VPC、子网权限”。

## 1. 环境级 API Key 是否支持 `manageFunctions/createFunction`

结论：**官方设计上支持；但官方没有公开 API Key 换出的临时 STS 策略全文。**

证据：

1. CloudBase MCP `v2.23.11` 官方连接文档将 `CLOUDBASE_API_KEY + CLOUDBASE_ENV_ID` 列为环境级认证，并明确推荐给 CI/CD、MCP Server 和 AI Agent；同页说明它会自动换取临时密钥，且优先级高于腾讯云 `SecretId/SecretKey` 和 Device Flow 登录。
   来源：[CloudBase MCP v2.23.11 connection-modes.mdx](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/v2.23.11/doc/connection-modes.mdx)
2. 同版本 MCP 的 `auth.ts` 在检测到 API Key 后调用 `AuthSupervisor.loginByApiKey()`；`functions.ts` 的 `createFunction` 分支随后调用 `cloudbase.functions.createFunction()`。
   来源：[v2.23.11 auth.ts](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/v2.23.11/mcp/src/auth.ts)、[v2.23.11 functions.ts](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/v2.23.11/mcp/src/tools/functions.ts)
3. 官方发布的 `@cloudbase/toolbox@0.8.1` 实现会向环境的 `/capi/credential` 发送 Bearer API Key，并取得 `TmpSecretId`、`TmpSecretKey`、`Token` 和过期时间。
   来源：[NPM 发布包：toolbox api-key.js](https://unpkg.com/@cloudbase/toolbox@0.8.1/lib/auth/api-key.js)、[NPM 包主页](https://www.npmjs.com/package/@cloudbase/toolbox/v/0.8.1)
4. 腾讯云 `CreateApiKey` 官方文档把 `api_key` 定义为“服务端管理员访问凭证”，并说明它具有数据库、云函数、云存储、托管等环境资源的完整访问与操作权限；`publish_key` 才是前端受限凭证。
   来源：[创建云开发平台的 API Key](https://cloud.tencent.com/document/product/876/129835)
5. CloudBase MCP 的官方工具文档把 `manageFunctions` 定义为云函数写入口，并包含 `createFunction`。
   来源：[CloudBase MCP 工具文档](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/main/doc/mcp-tools.md#managefunctions)

限定：第 4 项使用“数据流资源”措辞，而 `CreateFunction` 最终是 SCF 管控面调用；官方没有发布 `/capi/credential` 返回的 STS policy action 清单。因此“支持”来自官方 MCP 的认证实现、函数实现和 API Key 权限说明的组合证据，而不是一份单独的 action 对照表。

另一个同等重要的官方信号是，当前 MCP 的管控面错误指引把 API Key 描述为“常见仅授权数据面：DB/函数/存储”，并建议管控面权限失败时改用 Device Code，或使用具备 `QcloudTCBFullAccess`、`QcloudVPCReadOnlyAccess` 的腾讯云密钥。这与 FAQ 对 API Key 的宽泛推荐并不完全一致，应把它视为腾讯云文档/实现边界尚未统一，而不是让用户自行猜测并扩大角色权限。
来源：[当前 MCP 管控面 CAM 错误指引](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/main/mcp/src/tools/capi.ts#L184-L195)

## 2. `createFunction` 的实际鉴权主体

### 2.1 API Key 模式

真正签名 SCF 请求的是 API Key 换出的临时 STS 凭证。MCP 自身只是工具协议和调用编排层，不拥有云权限；`auth=READY` 只证明已经拿到可用凭证并绑定环境，不证明该临时凭证包含 `scf:CreateFunction`。

官方发布的 `@cloudbase/manager-node@5.5.0` 中，函数创建逻辑：

- 自动写入 `Namespace=<环境 namespace>`；
- 自动写入 `Role=TCB_QcsRole` 和 `Stamp=MINI_QCBASE`；
- 使用当前 Manager SDK 上下文中的 `secretId/secretKey/token` 直接向 SCF 调用 `CreateFunction`。

来源：[NPM 发布包：manager-node function/index.js](https://unpkg.com/@cloudbase/manager-node@5.5.0/lib/function/index.js)、[NPM 包主页](https://www.npmjs.com/package/@cloudbase/manager-node/v/5.5.0)、[SCF 创建函数 API](https://cloud.tencent.com/document/product/583/18586)

所以错误中的 `scf:CreateFunction` 是在校验临时 STS 调用者能否创建该 namespace 下的函数。SCF 官方也把 `CreateFunction` 列为资源级 CAM 操作。
来源：[SCF 权限管理概述](https://cloud.tencent.com/document/product/583/47932)、[SCF 策略语法](https://cloud.tencent.com/document/product/583/47934)

### 2.2 Device Flow / 网页登录

Device Flow 只是换取当前登录腾讯云身份的临时凭证，不会为该身份新增权限。个人开发和普通团队的官方默认是 Device Flow；子账号若要网页授权登录，还需要 CAM 只读权限，但这仍不等于拥有 SCF 写权限。
来源：[MCP 连接方式](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/v2.23.11/doc/connection-modes.mdx)、[使用 TCB 预设策略授权](https://cloud.tencent.com/document/product/876/47056)

如果 Device Flow 用的是主账号且资源确实属于该主账号，按 CAM 模型主账号应拥有名下资源权限；若仍得到相同的 namespace 拒绝，应优先核对登录主体与 namespace/环境所有者是否一致，而不是反复扫码。
来源：[SCF 角色与策略](https://cloud.tencent.com/document/product/583/47933)

## 3. `TCB_QcsRole` 的职责

`TCB_QcsRole` 是传给新函数的角色，不是发起 `CreateFunction` 的调用者。

- CloudBase 官方依赖资源指引要求 SCF 请求携带 `Stamp=MINI_QCBASE` 和 `Role`；普通单环境用户可直接使用默认 `TCB_QcsRole`，官方写明“无需额外配置”。
- 平台客户如果按环境承载多个小租户，官方反而建议不要共用 `TCB_QcsRole`，而是为每个环境建立独立角色，避免跨环境权限扩大。
- 服务角色缺失或无法取得角色时，SCF `CreateFunction` 文档列出的错误更接近 `FailedOperation.QcsRoleNotFound`、`FailedOperation.CallRoleFailed`、`InternalError.GetRoleError`；这与当前明确的 `scf:CreateFunction` 未授权不是同一类错误。

来源：[CloudBase 依赖资源接口指引：SCF 云函数](https://cloud.tencent.com/document/api/876/34808)、[SCF 创建函数错误码](https://cloud.tencent.com/document/product/583/18586)

`QcloudAccessForTCBRoleInAccessCloudBaseRun` 的官方描述是供 `TCB_QcsRole` 访问 CloudBase Run 及其 VPC/CVM 等依赖资源。它是较粗的服务角色策略，不是修复当前 API Key 临时 STS 缺少 `scf:CreateFunction` 的直接证据。
来源：[使用 TCB 预设策略授权](https://cloud.tencent.com/document/product/876/47056)

只有后续错误明确指向 `TCB_QcsRole` 不存在、角色读取失败、`cam:PassRole`，或函数运行时访问其他云资源失败时，才应检查或调整角色。不要把 `scf:CreateFunction` 授给这个运行角色来修复调用者权限。

## 4. VPC 与子网错误应如何判断

`VpcConfig` 是 SCF `CreateFunction` 的可选参数。MIP 因为需要从函数访问私网 MySQL，部署请求会带现有 VPC 和子网 ID。
来源：[SCF 创建函数 API](https://cloud.tencent.com/document/product/583/18586)

但当前证据只能说明 SCF 在创建权限检查处拒绝了请求：

- 仓库部署脚本直接从 `.env.local` 读取既有 VPC/子网 ID，然后把它们放入 `createFunction`；脚本没有先调用 VPC API 来查询或修改网络。
- SCF API 文档把错误 `InvalidParameterValue.Vpc` 定义为 VPC 不正确；这与 `scf:CreateFunction` 未授权是不同阶段和不同错误。
- 当前仓库文档中的“目标 VPC、子网无访问权”没有对应的原始 RequestId 或错误文本，不能作为已确认事实。

因此，应先修复 `scf:CreateFunction` 调用者。只有创建请求通过鉴权后返回明确的 VPC、子网、跨地域或相关 CAM 错误，再根据那条错误处理；现在预先授予 `vpc:*` 或给角色添加广泛 VPC 权限没有充分依据。

## 5. 当前 `mip-weapp` 的最小处理方案

### 推荐顺序

1. **保留环境 API Key，不给它或 `TCB_QcsRole` 盲目扩权。** 确认控制台创建的是 `api_key`，不是 `publish_key`，且 Key 与 `CLOUDBASE_ENV_ID` 属于同一环境。它仍适合环境数据面和受支持的自动化操作；不要把 API Key 发到聊天、日志或仓库。
2. **升级并固定当前官方 MCP 稳定版。** 仓库固定的是 `2.23.11`；调查时 NPM `latest` 为 `2.32.0`。`2.23.11` 到 `2.32.0` 增加了地域/站点和 `credential_scope=single_env` 的边界信息，官方 FAQ 也建议刷新到最新 MCP。当前环境只读回查为 `ap-shanghai`，所以没有发现地域不一致。升级属于代码改动，本次调查未执行。
   来源：[CloudBase MCP NPM](https://www.npmjs.com/package/@cloudbase/cloudbase-mcp)、[v2.32.0 release](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/releases/tag/v2.32.0)
3. **个人本地部署改用资源主账号 Device Flow。** 这是最新版 MCP 对管控面 CAM 失败给出的首选路径，也是官方 CLI 面向 Codex/MCP 的标准交互式登录方式。它只需要用户在浏览器确认一次，不需要新建永久腾讯云密钥，也不需要先修改 `TCB_QcsRole`。若登录的是子账号，则该子账号仍须已有相应资源权限。
4. **重试原始 `manageFunctions/createFunction`，只按真实下一条错误处理。** 记录 MCP 版本、登录主体是否为资源拥有者、环境地域和 SCF RequestId；不记录 API Key、SecretKey 或 SessionToken。当前没有 VPC/子网独立拒绝证据，不提前增加 VPC 权限。
5. **若最新版 + 资源主账号 Device Flow 仍返回 `scf:CreateFunction` 未授权，提交 CloudBase 工单。** 附 EnvID、地域、MCP 版本、RequestId、目标 namespace/函数名，以及 API Key FAQ 与当前 MCP 管控面错误指引两处相互冲突的官方链接。

### 临时替代路径

- **个人/人工部署：** 使用资源主账号的 Device Flow 登录。它是本次推荐的正常本地部署身份，不会修改环境 API Key 的后端 STS policy。
- **持续自动化且必须绕过 API Key：** 再考虑专用 CAM 子账号/角色，通过 `TENCENTCLOUD_SECRETID/SECRETKEY` 或短期 STS 运行 MCP。按 [SCF 策略语法](https://cloud.tencent.com/document/product/583/47934) 将权限限制到当前地域、namespace 和 `mip-*` 函数；只按实际 API 错误补充 action。若 SCF 明确拒绝传递 `TCB_QcsRole`，再添加限定到该角色的 `cam:PassRole`。这条路径维护成本和泄露面都高于环境 API Key，不是首选。
- **不推荐：** 给 `TCB_QcsRole` 关联广泛的 SCF/VPC 全访问、给个人账号授予 `scf:*`/`vpc:*`、反复执行 Device Flow、用 `managePermissions` 修改函数客户端安全规则。这些动作都没有修复当前临时 STS 调用者的直接证据。

## 6. 各组件职责对照

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| MCP / `manageFunctions` | 把工具参数交给 Manager SDK，打包并编排函数操作 | 不自带腾讯云权限，不绕过 CAM/STS |
| `auth(login_by_api_key)` | 用环境 API Key 换临时 STS 凭证并绑定单一 EnvID | 不验证每一个 SCF/VPC action 都可执行 |
| `auth(start_auth)` / Device Flow | 取得当前腾讯云登录身份的临时凭证 | 不为当前账号新增权限 |
| CloudBase API Key | 环境级服务端管理员凭证；官方设计用于 MCP/CI | 不是 CAM 子账号，用户不能给它直接关联自定义 CAM 策略 |
| 临时 STS 凭证 | 实际签名 TCB、SCF 等腾讯云 API 请求 | 权限上限由签发端下发的临时 policy 决定 |
| `TCB_QcsRole` | 新函数绑定的默认角色，使函数/SCF 在角色策略范围内访问依赖资源 | 不是当前 `CreateFunction` 请求的调用者 |
| CAM 子账号/永久密钥 | 可作为 API Key 之外的自动化身份，能用自定义策略细粒度授权 | 不是环境 API Key 的必需配套项 |
| `managePermissions` | 修改 CloudBase 应用调用者对函数/数据库/存储的资源安全规则 | 不能修改 CAM、STS policy 或 `TCB_QcsRole` |

## 7. 仍然不确定的事项

- 腾讯云没有公开 `/capi/credential` 为环境 API Key 签发的完整 STS policy，无法仅靠公开文档列出它应包含的全部 SCF/VPC/CAM action。
- 本次没有重新调用 `CreateFunction`，因此没有新的 RequestId，也没有验证最新 MCP 是否仍复现。
- 当前没有独立 VPC/子网拒绝的原始错误；VPC 权限缺失仍是未证实推断。
- 官方 GitHub 曾记录过相同 `scf:CreateFunction` 未授权错误，维护者当时针对 CodeBuddy 集成建议重新配置集成；该记录证明这类错误可能来自集成凭证，不足以证明当前问题的根因。
  来源：[CloudBase MCP issue #136](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/issues/136)

## 8. 当前环境实际验证结果

2026-08-24 已完成以下实测：

1. 仓库将 CloudBase MCP 从 `2.23.11` 固定升级到 `2.32.0`。
2. 环境 API Key 仍可查询目标环境和 MySQL，但原始 SCF `CreateFunction` 拒绝不应归因于 `TCB_QcsRole`。
3. 经维护者明确授权，资源主账号 Device Flow 返回 `auth=READY`、`env=READY`；同一 `manageFunctions/createFunction` 随后成功。
4. MCP `2.32.0` 的 `getInstanceInfo` 只返回生命周期字段；显式 `getConnectionInfo` 返回实际 MySQL `VpcId`/`SubnetId`。部署脚本只在缺少网络元数据时读取该载荷并提取两个字段，不输出其余内容。
5. 16 个核心 `mip-*` 函数全部创建、配置并通过真实 MySQL 健康检查；独立 `cloud:verify` 又验证了 schema、83 张表的精确 runtime 权限、函数状态、客户端调用边界和禁止高频 timer。

因此，当前环境的最小正确处理已经被实测确认：不修改 `TCB_QcsRole`，不预授 VPC 全权限；升级 MCP，并在获得明确授权后用资源主账号 Device Flow 执行 SCF 管控面部署。
