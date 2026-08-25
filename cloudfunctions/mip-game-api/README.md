# mip-game-api

团队 PK、赛季、排行榜和队伍大本营服务。排行榜与对阵分数仅从 MySQL 成长流水生成，客户端不提交分数。

微信小程序和后续 Web 管理端统一使用 `{ contractVersion: 1, action, input }` 请求。服务端暂时兼容旧扁平请求，但只以顶层 `action` 路由；业务输入中的 `action`、`contractVersion` 和 `input` 不参与路由。
