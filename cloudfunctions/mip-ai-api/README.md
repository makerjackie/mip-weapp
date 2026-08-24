# mip-ai-api

MIP AI 草稿服务。服务只生成、保存和更新可过期草稿，不直接写正式档案、合作卡或超级案例。个人档案、合作卡和案例服务在保存正式资源的同一数据库事务内确认草稿来源，AI 服务不提供独立确认入口。

草稿默认保留 72 小时，可通过 `MIP_AI_DRAFT_TTL_HOURS` 设置为 1–168 小时。语音上传通过对象范围校验后先登记 ownerless `PENDING` 清理事实，再在锁定 `ACTIVE` 用户的事务内绑定 owner、改为 `READY` 并创建草稿；事务结果不明确时先重读素材和草稿，不能盲删可能已经提交的对象。确认、过期或删除的语音素材会在用户访问 AI 草稿时重试删除；无人再次访问时，运行 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 扫描当前 AppID 的过期草稿、终态语音和没有草稿的上传 tombstone。两条路径复用同一删除租约：先把素材置为 `PENDING` 并记录 `updated_at`，事务外删除云对象，再按相同租约把素材标记为 `DELETED`。ownerless tombstone 只允许使用 AppID scope 和完整 object key 校验后删除；对象删除失败、响应不明确、租约丢失或数据库最终更新失败时保留 `PENDING`，不恢复为 `READY`，30 分钟后可重试。

维护 action 只接受 `MIP_ALLOWED_APP_IDS` 内的 AppID，并使用已部署的 `MIP_AI_HMAC_SECRET` 校验五分钟内时间戳和完整未签名 body。单次最多处理 20 条；响应只包含状态及过期、扫描、删除、失败数量，不包含用户、草稿或文件标识。该命令由运营人员显式执行，不安装定时器。

未配置 `MIP_AI_PROVIDER_FUNCTION_NAME` 时，语音和文本整理明确返回不可用，不生成伪造结果。

AI Provider 必须使用 `mip-` 前缀的独立云函数，并校验请求中由 `MIP_AI_HMAC_SECRET` 生成的 HMAC 签名及时间戳；Provider 签名绑定动作、AppID、草稿、用途和输入摘要，维护签名绑定完整未签名 body。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_IDENTITY_PEPPER`、`MIP_AI_PROVIDER_FUNCTION_NAME`、`MIP_AI_HMAC_SECRET`、`MIP_AI_STORAGE_KEY`、`MIP_AI_DRAFT_TTL_HOURS`、`MIP_DEPLOYMENT_STAGE`、`MIP_DB_CONNECTION_URI`。
