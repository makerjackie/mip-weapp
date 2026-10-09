# 后台 HTTPS 证书自动续期

本仓库的续期实现为独立 `mip-admin-cert-renewer`，每天检查目标管理域名的当前证书。剩余有效期不超过 30 天时，通过腾讯云 `ApplyCertificate` 申请免费的 TrustAsia C1 DV 证书，自动写入 FILE 域名验证文件，等待 CA 签发后只更新该域名的 `CertId`。必须回读网关和真实 TLS 指纹一致，才能记录成功。真实 SSL DTO 的 `DvAuthDetail.DvAuths[].Domain` 是完整域名，`DvAuthDomain` 可能只有根域名；验证完整域名并拒绝其他域名，不能把根域名字段当作完整域名。

官方免费续期实际上是签发新证书：[ApplyCertificate](https://cloud.tencent.com/document/api/400/41678)。第三方 DNS 不使用 `DNS_AUTO`；本实现通过公开站点的验证文件完成认证，保留既有阿里云 DNS、HTTP→HTTPS 与后台来源保护。默认测试域名有使用限制，不作为永久生产备用域名。

## 权限与状态

- 专用 `MIPAdminCertRenewerRole` 只信任 SCF，关联 `MIPAdminCertRenewerPolicy`；不修改共享角色。
- SSL 免费申请是操作级权限；读取、检查验证需要覆盖本账号未来新证书 ID。TCB 修改限定当前环境，源码另外校验精确管理域名及既有三个路由。COS 限定私有状态对象及后台前缀内的 CA 验证目录。
- SCF 创建还需要日志主题/日志集元数据读取。专用 CLS 日志保留 7 天，写入仅授权该专用主题；没有日志搜索、修改、删除权限。不要绑定 `queryEnv.LogServices` 里已失效的旧主题，必须验证真实 CLS 主题与日志集的对应关系。
- 运行凭证取自本次 SCF invocation 的临时凭证，不部署本机 API Key、SecretId/SecretKey、浏览器会话或阿里云密钥。
- 日常状态读取用 `DescribeCertificate`；该接口不返回 PEM。只有待替换证书签发后才调用 `DescribeCertificateDetail` 获取公钥证书并计算指纹；详情响应也含私钥，严禁记录、持久化或输出原始响应。详见[官方详情接口](https://cloud.tencent.com/document/product/400/41673)。
- SDK 客户端调用禁止，无 HTTP 入口；timer 参数有独立 HMAC。申请前通过 COS `x-cos-forbid-overwrite:true` 原子写入该旧证书的永久申请记录，防止并发或重试消耗重复额度。运行时检查状态桶未开启版本控制，canary 必须实测同名第二次写入被拒绝。仅持久化 `applying` 不能防止多实例竞争；CloudBase 的 SCF 并发设置接口可能返回 `FailedOperation.UpdateFunctionConfiguration`，不能靠忽略该错误宣称单并发。
- 不连接 MySQL、不调用业务函数、不配置 VPC。证书检查 timer 不得进入核心业务函数部署列表。
- 状态保存在私有 COS 对象。待签发订单每日复查；API 响应不明时持久化 `applying` 并停止再申请，避免耗尽免费额度。此情况须在 SSL 控制台核对申请别名，再由维护者准确补回 pending ID；不可盲目清空状态。
- 调用失败写入 SCF 错误日志。启用前应配置云监控的函数错误告警和证书到期提醒；没有实测告警接收时明确记录该边界。

## 首次启用

1. 使用仓库 Node/pnpm，审计并保留无关修改，通过 `pnpm verify:all`。检查当前域名为 DIRECT、HTTP_TO_HTTPS、正常启用，`/` 指向管理后台静态前缀，`/api`、`/assets` 指向既有 BFF。
2. 从 `queryEnv` 读取资源归属、区域和两个 COS bucket；不复制历史标识。以下命令的所有阶段都需要 `--domain=<管理域名> --confirm-env=<已核实环境> --confirm-function=mip-admin-cert-renewer`，production 追加 `--confirm-production`：

   ```bash
   node scripts/admin-cert-renewal.mjs prepare <上述确认参数>
   node scripts/admin-cert-renewal.mjs logs <上述确认参数> --confirm-log-resources=<同一管理域名>
   node scripts/admin-cert-renewal.mjs role <上述确认参数>
   node scripts/admin-cert-renewal.mjs deploy <上述确认参数>
   node scripts/admin-cert-renewal.mjs canary <上述确认参数>
   ```

   `prepare` 仅生成本机私有配置和具体权限。角色创建被环境密钥拒绝时，不改写认证文件或扩大共享角色；使用已授权的官方通道，在权限审批处给出具体策略。浏览器操作涉及新增安全权限时按工具要求取得当次确认。SCF 控制操作需要 Device Flow 时依根 AGENTS 的维护者显式授权规则执行。

   `logs` 通过本机管理临时凭证创建/核对独立日志集与主题，将 ID 和归属回读保存在 `dedicated-logs.private.json`；不在运行角色内授予创建日志资源权限。若精确旧策略已包含证书详情和原子申请保护、但没有 CLS 权限，或者日志写入还指向环境旧主题，`role` 追加 `--confirm-log-permission=<同一管理域名>`，仅允许从这两种精确历史策略升级。其他权限漂移仍拒绝覆盖。

   从不含原子申请记录的精确旧策略升级时，`role` 追加 `--confirm-claim-permission=<同一管理域名>`。新增范围只有该域名私有 `applications/*` 的读取/写入和状态桶版本配置读取，没有删除权限；申请结果不明时保留永久记录并核对 SSL 订单，不能删记录后盲目重试。

   从已完整配置日志和原子保护、但只有 `DescribeCertificate` 的精确旧策略升级时，`role` 追加 `--confirm-certificate-detail-permission=<同一管理域名>`，只增加原证书资源范围内的 `DescribeCertificateDetail`。多个历史差异同时存在时脚本拒绝覆盖，应先核对完整策略并准确迁移，不能把确认参数视为任意权限覆盖授权。

   若角色已创建，但 API Key 无权读取 CAM，可在控制台读取角色归属、角色 ID、完整信任 JSON、唯一关联策略及其完整当前 JSON，保存到专用 `.tmp/admin-cert-renewal-<域名>/role-console.private.json`。结构为 `{source:"TENCENT_CAM_CONSOLE",observedAt:<ISO时间>,roleName,roleId,resourceUin,trust,policy,attachedPolicies:[{policyName,policyId}]}`。`role` / `deploy` 追加 `--verified-role-file=<此私有文件>`；脚本要求 30 分钟内的精确回读，拒绝权限漂移。该方式只替代 CAM 读取，不修改权限或绕过云端授权。
3. `deploy` 以原始 SCF CreateFunction 从首次创建即绑定专用角色，禁止 MCP 注入共享 TCB 角色；CloudBase 创建接口须传 `Stamp: "MINI_QCBASE"`（[官方依赖资源接口说明](https://cloud.tencent.com/document/product/876/34808)），缺失时会报 `InvalidParameterValue.Stamp`，不能误判为权限不足。GetFunction 不接受此参数。若返回 RequestId 后回读为 `CreateFailed`，查看私有 `StatusReasons`：`cls:DescribeTopics` 权限错误须核对专用角色日志元数据权限；`ClsLogSetId & ClsTopicId not matched` 须回读真实 CLS 对应关系。账户 Device Flow 不替代执行角色权限。仅对精确匹配本机原创建 ZIP 标记、无触发器的失败创建，保存配置与该 ZIP 后恢复；平台不允许下载 `CreateFailed` 的代码包，此例外不得用于 Active。下载最终 ZIP 后检查平台摘要及全部运行文件字节。现有部署先暂停该专用 timer 并回读；保存旧代码与配置，再重新走 canary。
4. 使用配置的 `MIP_SCF_TIMER_UTC_OFFSET_MINUTES` 排一个两分钟后的单次 CANARY；首次先按官方 UTC 配置 `0`，以实际执行验证时区。等私有 COS `lastCanary` 出现匹配 generation、实际执行时间与 `guard: COS_CREATE_ONLY`，再执行：

   ```bash
   node scripts/admin-cert-renewal.mjs activate <上述确认参数>
   node scripts/admin-cert-renewal.mjs check <上述确认参数>
   node scripts/admin-cert-renewal.mjs status <上述确认参数>
   ```

   没有 timer 真正执行和原子申请保护证据，`activate` 拒绝启用。日计划固定 UTC 03:17（北京时间 11:17），回读唯一 timer 的 cron、OPEN、参数签名和运行代码标记。CloudBase 可能把 `TriggerDesc` 回读为 `{"cron":"..."}`，需解析后比较，不把这个封装差异误判为创建失败。只读状态中出现 `lastCanary` 才是执行证明。代码更新完成会删除本机旧 canary 计划，不能用更新前的执行记录重新激活。
5. 用 `force ... --confirm-free-issuance=<同一管理域名>` 申请一个真实免费验证订单；需要明确当前用户已授权该实测。随后 `check` 直至 CA 签发、证书绑定、实际可信 TLS 指纹与新证书匹配。CA 仍待验证时记 PENDING，不能称闭环通过；权限被拒绝时记 BLOCKED。不能把控制台“开启”按钮或单元测试当成实际续期证明。
6. 复验公开资产及真实登录，确保前端版本、旧入口、来源规则和路由保持不变。动态结果保存到 `PROJECT_STATUS.md` 和脱敏 evidence；私有配置、HMAC、账户归属、CA 私钥和完整云端回读仅留忽略目录。

## 日常更新与故障恢复

普通后台发布不会重部署或覆盖续期函数。需要更新续期实现时，先执行 `pause <上述确认参数>` 并核对 CLOSE，再备份代码/状态，验证门禁与 canary 后重新激活。`status` 读取待签发状态、最后检查、最后真实 TLS 成功和 timer；不得从本机退出码推断云端成功。

证书替换已提交但 TLS 尚未传播时，保留 pending ID 并复查，不能重复申请。发现域名绑定或路由被其他维护者修改时停止，不恢复历史快照覆盖新配置。免费配额不足、账户授权撤销或 CA 失败需按云端错误处理；不自动购买证书、关闭 HTTPS、绕过 TLS 验证或扩大权限。
