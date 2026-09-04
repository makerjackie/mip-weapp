# ADR 0006：网页登录小程序码

状态：已接受，补充 ADR 0005 的网页登录方式。

## 决策

React Web 的运营登录以动态微信小程序码为主，6 位数字登录码作为降级入口。两种入口使用同一个 5 分钟、单次消费、绑定浏览器 verifier 的登录 challenge；不新增手机号密码或短信验证码账号体系。

网页创建 challenge 后，由 `mip-admin-api` 调用 `wxacode.getUnlimited` 生成指向 `packages/admin/web-login-confirm/index` 的小程序码。`scene` 仅包含不可预测的 32 字符 challenge token，不包含手机号、OpenID、AppID、角色或其他身份事实。二维码图片只在本次响应中以受限 data URL 返回，不写对象存储或业务数据库。

扫码只打开确认页，不自动授权。确认页仅在页面实例内暂存 `scene`，先完成 `ENTER_ADMIN` 身份流和 `admin:enter` capability 检查，再由用户明确点击确认。`mip-admin-api` 重新读取当前运营 session 和角色权限后，使用独立 HMAC 将可信小程序身份提交给 Web BFF。浏览器仍必须持有匹配的 `HttpOnly` challenge Cookie，才能把已确认 challenge 换成运营会话。

## 安全边界

- `packages/admin/web-login-confirm/index` 是无业务数据的预认证落地页，也是唯一新增的全局访问豁免管理路由；现场工作台的四条运营路由仍受原全局身份门禁保护。
- `scene` 不进入页面 data、本地 Storage、日志、审计 metadata 或浏览器 JSON 响应。
- 小程序确认支持 `challengeCode` 与 `challengeToken` 二选一；过期、已消费、格式错误或同时提交两种值均失败关闭。
- 小程序码生成请求使用独立的 `MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET`，与管理查询和登录确认 HMAC 隔离，并复用既有 MySQL nonce 防重放表。
- 二维码生成、校验或上游调用失败时，网页登录仍返回 6 位数字码；该降级不放宽运营权限、AppID allowlist 或浏览器绑定。

## 结果

- 用户可以用微信扫一扫直接打开 MIP 确认页，账号仍与小程序当前微信身份互通。
- 小程序现场工作台继续提供手工输入 6 位码，不依赖短信服务和手机号验证码额度。
- 生产可通过不配置 Pages 的小程序码专用 secret/目标 AppID 关闭二维码入口，同时保留原数字码登录。
