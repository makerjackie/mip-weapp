# mip-growth-api

MIP 成长查询与服务端奖励入口。普通用户只能读取自己的余额和流水；奖励写入只接受带 HMAC 的已确认业务事件，并受服务端规则、每日上限和幂等键约束。签到投影只接收 transition id，服务内回查不可变关系事实；撤销按原实际 delta 追加反向流水。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_IDENTITY_PEPPER`、`MIP_GROWTH_HMAC_SECRET`、`MIP_DB_CONNECTION_URI`。
