# mip-tasks-api

任务卡、成员派发、用户完成事实、经验值奖励和运营流水的独立服务边界。

- 用户动作：本人有效范围内的任务列表、任务详情、模板下载和单次完成。
- 管理动作：配置全员或指定成员任务、适用成长等级精确集合、截止时间和模板，搜索成员、批量派发或软撤销、发布、下架、软删除、完成流水与导出。
- 服务端在同一事务内写完成事实、成长流水和 outbox；客户端不能提交奖励值或完成状态。
- 没有成长等级规则表示全部等级；有规则时，列表、详情和完成动作都按服务端当前经验对应的启用等级重新校验，客户端不能提交当前等级。
- 管理端更新任务时，省略 `eligibleLevelIds` 表示保留当前等级规则；只有显式提交 `[]` 才解除等级限制。
- 附件只接受当前用户拥有的 `READY` / `TASK_ATTACHMENT` 图片素材。
- 模板只接受平台运营经 `mip-media-api` 上传的 `READY` / `TASK_TEMPLATE` 图片素材。
- 微信小程序和后续 Web 管理端统一使用 `{ contractVersion: 1, action, input }` 请求；服务端暂时兼容旧扁平请求，但只以顶层 `action` 路由，业务输入不能覆盖动作。

## 管理端内部调用

Web 管理端不直接调用本函数，也不把浏览器 principal 传入任务领域。`mip-admin-api` 从当前服务端 session 解析真实管理员 `userId`，校验平台范围 `tasks.manage` 后，通过 `MIP_TASKS_ADMIN_HMAC_SECRET` 调用 `mip-tasks-api` 的 `mip-tasks-admin/v1` transport。两端必须配置同一、且不同于 Web BFF/login 的至少 32 字符密钥；目标函数名由 `MIP_TASKS_FUNCTION_NAME` 指定（默认 `mip-tasks-api`）。缺少密钥、AppID 不在 allowlist、签名过期/不匹配、未知 action 或字段时拒绝执行。所有内部管理写操作还必须携带签名覆盖的 `idempotencyKey`；任务写入和 `mip_idempotency_keys` 的领取、结果固化在同一 MySQL 事务内完成，使相同请求可以安全重试，不同请求复用同一 key 会被拒绝。部署脚本会为 admin/tasks 两端注入并在云端回读校验该链接；密钥只放 `.env.local` 或函数环境变量。
