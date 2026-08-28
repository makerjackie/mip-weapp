# MIP Media API

小程序端继续通过可信微信上下文上传用户本人素材。服务端执行图片解码、格式与尺寸校验、重编码、内容安全、隔离存储和 `mip_media_assets` 持久化；客户端不能直接声明素材已可用。

Web 管理端只调用 `mip-admin-api` 的 `mip.admin.media.uploadImage`。管理函数按图片用途重新校验平台范围 capability，再以独立的 `MIP_MEDIA_ADMIN_HMAC_SECRET` 调用本函数的 `mip-media-admin/v1` trusted adapter。签名覆盖 AppID、真实管理员 userId、用途、完整图片、来源函数、时间戳和 nonce；目标函数还会再次读取 ACTIVE 平台管理员角色与自定义 capability 策略。

当前 Web 管理用途仅开放 Banner、活动封面/正文/相册、机会封面、超级案例封面/媒体和任务模板。头像与用户任务附件仍必须由对应用户流程上传。该内部入口不接受浏览器 principal，也不放宽原微信入口。
