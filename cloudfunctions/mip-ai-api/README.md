# mip-ai-api

MIP AI 草稿服务。服务只生成、保存和更新可过期草稿，不直接写正式档案、合作卡或超级案例。个人档案、合作卡和案例服务在保存正式资源的同一数据库事务内确认草稿来源，AI 服务不提供独立确认入口。

草稿默认保留 72 小时，可通过 `MIP_AI_DRAFT_TTL_HOURS` 设置为 1–168 小时。语音上传通过对象范围校验后先登记 ownerless `PENDING` 清理事实，再在锁定 `ACTIVE` 用户的事务内绑定 owner、改为 `READY` 并创建草稿；事务结果不明确时先重读素材和草稿，不能盲删可能已经提交的对象。确认、过期或删除的语音素材会在用户访问 AI 草稿时重试删除；无人再次访问时，运行 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 扫描当前 AppID 的过期草稿、终态语音和没有草稿的上传 tombstone。两条路径复用同一删除租约：先把素材置为 `PENDING` 并记录 `updated_at`，事务外删除云对象，再按相同租约把素材标记为 `DELETED`。ownerless tombstone 只允许使用 AppID scope 和完整 object key 校验后删除；对象删除失败、响应不明确、租约丢失或数据库最终更新失败时保留 `PENDING`，不恢复为 `READY`，30 分钟后可重试。

维护 action 只接受 `MIP_ALLOWED_APP_IDS` 内的 AppID，并使用已部署的 `MIP_AI_HMAC_SECRET` 校验五分钟内时间戳和完整未签名 body。单次最多处理 20 条；响应只包含状态及过期、扫描、删除、失败数量，不包含用户、草稿或文件标识。该命令由运营人员显式执行，不安装定时器。

未配置 `MIP_AI_PROVIDER_FUNCTION_NAME`，或目标函数的 `readiness` 未通过上游鉴权与协议回读时，语音和文本整理能力明确返回不可用，不生成伪造结果。readiness 在函数暖实例内缓存 60 秒；业务请求仍独立执行完整 Provider 校验。

数字分身使用独立的 `MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME`。未配置时只关闭数字分身能力，不影响已有文本和语音草稿。生成前服务端锁定当前用户，确认素材是本人档案当前绑定的 `READY` `AVATAR`；Provider 只能返回 `imageBase64`、`contentType` 和 `providerJobKey`，不能用 URL 或素材 ID直接声明结果。返回图片会在 AI API 内完整解码、重新编码、执行微信图片内容安全检查并写入 `mip/.../digital-avatars/`，然后在同一数据库事务中把 ownerless `PENDING` 素材与生成记录推进到 `READY`。客户端只读取生成记录，不决定生成状态或输出素材。

用户可在 `DRAFT_READY` 状态连续补充信息。每轮先用版本号把草稿短暂转为 `STRUCTURING`，Provider 只返回新的结构化草稿；服务端自行追加用户原文。Provider 失败时恢复上一版可用草稿，版本冲突要求客户端刷新。完成补充仍只是临时草稿，只有个人档案、合作卡或超级案例编辑页在正式保存事务中校验草稿并写入对应资源，同时把草稿标为 `CONFIRMED`。

Provider 通过 `MIP_AI_PROVIDER_ADAPTER` 选择。当前正式适配器值为 `cloud_function`，空值也按该适配器处理；其他值会明确降级为不可用。测试可注入内存 Provider，但运行时没有 mock 成功路径。草稿 Cloud Function Provider 必须使用 `mip-` 前缀的独立函数，并实现 `structureText`、`transcribeAndStructure` 与 `refineDraft` 三个 action。`refineDraft` 接收当前转写、当前结构化草稿和本轮补充，至少返回 `structuredDraft`；其他两个 action 还必须返回 `transcriptText`。数字分身 Provider 同样使用 `mip-` 前缀函数并实现 `generateDigitalAvatar`；请求绑定源文件摘要、尺寸和稳定风格 key，响应严格返回 `imageBase64`、`contentType` 和 `providerJobKey`。所有 job key 只做 SHA-256 摘要留存。

草稿 Provider 契约固定为 `mip.ai.draft-provider.v1`。请求和响应都使用专用 `MIP_AI_DRAFT_PROVIDER_HMAC_SECRET` 对完整版本化 envelope 签名，并校验五分钟内时间戳、AppID/action allowlist、稳定 request ID、operation key、payload/data digest 和精确字段集合。语音请求额外绑定 CloudBase file ID、SHA-256、字节数和类型；Provider 原始错误和用户输入不得写入普通业务日志或返回客户端。该密钥不得复用于 AI 清理、数字分身或上游 HTTP 鉴权。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_IDENTITY_PEPPER`、`MIP_AI_PROVIDER_ADAPTER`、`MIP_AI_PROVIDER_FUNCTION_NAME`、`MIP_AI_PROVIDER_TIMEOUT_MS`、`MIP_AI_DRAFT_PROVIDER_HMAC_SECRET`、`MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME`、`MIP_AI_HMAC_SECRET`、`MIP_AI_STORAGE_KEY`、`MIP_AI_DRAFT_TTL_HOURS`、`MIP_DEPLOYMENT_STAGE`、`MIP_DB_CONNECTION_URI`。
