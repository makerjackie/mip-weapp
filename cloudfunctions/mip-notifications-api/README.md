# mip-notifications-api

MIP 用户态消息函数。小程序通过本函数读取站内消息、标记已读，记录用户在微信订阅消息授权弹窗中的真实选择，并在用户实际进入微信客服会话时登记服务端 48 小时补充投递窗口。

本函数只接受可信 CloudBase 用户上下文，不接受客户端传入的 AppID、用户 ID 或 OpenID。站内消息写入和微信订阅消息投递由受 HMAC 保护的 `mip-notification-worker` 负责。

环境变量：`MIP_ALLOWED_APP_IDS`、`MIP_IDENTITY_PEPPER`、`MIP_NOTIFICATION_ENCRYPTION_KEY`、`MIP_SUBSCRIBE_TEMPLATES_JSON`、`MIP_CUSTOMER_SERVICE_ENABLED`、`MIP_DB_CONNECTION_URI`。
