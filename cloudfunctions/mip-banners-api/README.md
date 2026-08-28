# mip-banners-api

Banner 公开读取与平台运营管理的独立服务边界。

- 公开端只读取启用、排序完成且素材仍然有效的 Banner。
- `banners.manage` 仅授予平台负责人和平台运营。
- 新增、编辑、排序、启停和软删除均校验版本并写入 `mip_audit_logs`。
- 素材必须属于当前操作者，或已经绑定到当前 Banner；状态为 `READY`、用途为 `BANNER`，尺寸至少 `750×300`，宽高比为 `1.8–3.2`。
- 小程序跳转只接受服务端固定路由 allowlist，文章跳转只接受微信公众平台 HTTPS 文章链接。
- Banner 请求统一使用 `{ contractVersion: 1, action, input }`，服务端暂时兼容旧扁平请求；路由只读取顶层 `action`，业务输入中的路由字段会被忽略。
- Banner 图片继续通过 `mip-media-api` 的 `uploadImage` 合同上传，不属于上述 8 个 Banner action。
- Web 管理端只调用 `mip-admin-api` 的 7 个 `mip.admin.banners.*` operation。管理函数复核当前 session 和平台范围 `banners.manage` 后，以独立 `MIP_BANNERS_ADMIN_HMAC_SECRET` 调用本函数的 `mip-banners-admin/v1` trusted adapter；两端密钥必须一致、至少 32 字符，且不能与 Web BFF、登录或任务密钥复用。
- trusted adapter 只接受允许的 AppID、真实管理员 UUID、固定来源 `mip-admin-api`、60 秒内时间戳、签名 nonce 和逐 action 输入白名单。缺少配置、函数超时、签名或字段不匹配时拒绝执行。原有微信请求仍走可信微信上下文、协议/手机号/资料门禁和 Banner 权限校验，不接受内部请求携带的身份字段。
