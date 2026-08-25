# mip-banners-api

Banner 公开读取与平台运营管理的独立服务边界。

- 公开端只读取启用、排序完成且素材仍然有效的 Banner。
- `banners.manage` 仅授予平台负责人和平台运营。
- 新增、编辑、排序、启停和软删除均校验版本并写入 `mip_audit_logs`。
- 素材必须属于当前操作者，或已经绑定到当前 Banner；状态为 `READY`、用途为 `BANNER`，尺寸至少 `750×300`，宽高比为 `1.8–3.2`。
- 小程序跳转只接受服务端固定路由 allowlist，文章跳转只接受微信公众平台 HTTPS 文章链接。
- Banner 请求统一使用 `{ contractVersion: 1, action, input }`，服务端暂时兼容旧扁平请求；路由只读取顶层 `action`，业务输入中的路由字段会被忽略。
- Banner 图片继续通过 `mip-media-api` 的 `uploadImage` 合同上传，不属于上述 8 个 Banner action。
