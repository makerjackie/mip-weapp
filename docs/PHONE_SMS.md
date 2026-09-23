# 手机号短信换绑

最新流程 J5-02 路径 B 通过身份域的 `requestPhoneSms` → `bindSmsPhone` 执行；微信一键授权路径保持可用。短信验证码校验成功后复用已有 `repository.bindPhone`、手机号加密和 AppID 内号码唯一约束。验证码不会触发账号合并；号码已绑定其他账号时返回 `PHONE_ALREADY_BOUND`，原号码保留。

## 服务端契约

- 两个动作只使用 CloudBase 可信上下文解析 AppID / 微信身份，要求已有 ACTIVE 用户。客户端不能指定用户或 AppID。
- `requestPhoneSms { phone }` 只接受大陆 11 位手机号。成功返回 `challengeId / retryAfterSeconds: 60 / expiresAt / status: ACCEPTED`，不返回验证码或号码。
- `bindSmsPhone { phone, code, challengeId }` 将挑战绑定 AppID、用户、号码，验证码有效期 5 分钟、最多错误 5 次、成功仅使用一次。新请求使本人旧挑战失效。
- 发送同时按用户和号码限制：60 秒冷却，滚动窗口每小时最多 5 次、24 小时最多 10 次。数据库事务锁序列化并发。供应商失败仍占额度，避免网络超时重试造成重复短信或费用。
- 数据库只存验证码的 HMAC-SHA256 和 AppID 域手机号 hash，验证码、明文号码、供应商原始响应均不记录日志。验证码消费和已有手机号更新在同一事务内；号码冲突回滚消费；错误次数通过独立成功提交保留。
- 供应商受理不等于手机已送达。客户端仅显示“验证码请求已受理，请查看手机短信”；无配置返回 `SMS_DISABLED`，超时/供应商拒绝返回 `SMS_SEND_FAILED`，不自动重试。页面真实成功由身份快照确认。

## 配置与上线条件

迁移 `084_phone_sms_verification.sql` 创建挑战和限流表，runtime 仅有 SELECT/INSERT/UPDATE 权限。配置全部属于服务端，`scripts/deploy-functions.mjs` 仅向 `mip-identity-api` 注入：

| 配置 | 内容 |
| --- | --- |
| `MIP_SMS_ENABLED` | 默认 false；供应商准备完成后显式启用 |
| `MIP_SMS_SECRET_ID` / `MIP_SMS_SECRET_KEY` | 仅有必要短信发送权限的腾讯云访问凭证；env:compact 移入本地私密文件 |
| `MIP_SMS_SDK_APP_ID` | 腾讯云短信应用的 SDK AppID，与微信 AppID 不同 |
| `MIP_SMS_SIGN_NAME` | 已审核通过的国内短信签名 |
| `MIP_SMS_TEMPLATE_ID` | 已审核通过的验证码模板，两个顺序参数为 `[验证码, 有效分钟数]` |
| `MIP_SMS_REGION` | 默认 ap-guangzhou |

HMAC 使用现有 `MIP_PHONE_ENCRYPTION_KEY` 加独立用途标签；不另造客户端密钥。`.env.example` 只列空值，凭证不得进入源码、前端构建和日志。

供应商应用、签名与模板审核、额度及部署配置尚需环境实际确认；未满足时短信路径应保持 disabled。测试使用内存事务和虚拟供应商，不发送真实短信。正式验收还需在授权后完成迁移与函数部署、真机号码收码、微信绑定冲突、60 秒冷却、验证码过期/一次消费和号码更新核验，不能以本地测试代替送达或上线证据。

## 官方接口依据

- [腾讯云 SendSms 2021-01-11](https://cloud.tencent.com/document/api/382/55981)：固定 `sms.tencentcloudapi.com` 端点、E.164 号码、应用/签名/模板与参数，检查单条 `SendStatusSet.Code = Ok`。
- [腾讯云 TC3-HMAC-SHA256 签名](https://cloud.tencent.com/document/api/213/30654)：规范请求、日期/服务作用域、HMAC 派生与 Authorization。适配器不接受用户提供的目标 URL、不跟随跳转、不自动重试。
