# mip-game-api

团队 PK、赛季、排行榜和队伍大本营服务。排行榜与对阵分数仅从 MySQL 成长流水生成，客户端不提交分数。

微信小程序和后续 Web 管理端统一使用 `{ contractVersion: 1, action, input }` 请求。服务端暂时兼容旧扁平请求，但只以顶层 `action` 路由；业务输入中的 `action`、`contractVersion` 和 `input` 不参与路由。

Web 管理端不直接调用本函数。`mip-admin-api` 在当前管理员 session 与平台范围 `game.manage` 复核后，以独立 `MIP_GAME_ADMIN_HMAC_SECRET` 调用 `MIP_GAME_FUNCTION_NAME`（默认 `mip-game-api`）。内部桥固定为 `MIP_GAME_ADMIN_V1` / `mip-game-admin/v1`，只接受允许的 AppID、管理员 UUID、固定来源 `mip-admin-api`、60 秒内时间戳、签名 nonce 和 20 条 action 的逐层输入白名单。赛季阈值、战队成员、赛况和盲盒配置的嵌套字段同样拒绝未知项。

其中 12 条管理写 action 强制使用签名覆盖的顶层 `idempotencyKey`，8 条查询 action 禁止携带该字段。写操作复用 `mip_idempotency_keys`，并在同一个 Game MySQL 事务内完成管理员复核、幂等认领、业务事实、审计/outbox 与响应固化；同键同请求回放已固化响应并返回 `idempotent: true`，请求漂移或未完成记录拒绝执行，失败事务允许原键安全恢复。

原微信请求仍走可信微信上下文、完整访问门禁和游戏权限校验，不接受内部身份字段。内部结算每周赛况成功后使用签名请求中的可信 AppID 唤醒 outbox；失败或未验签请求不会触发领域写入或 outbox。
