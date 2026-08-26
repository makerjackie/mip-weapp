# mip-ai-avatar-provider

独立的数字分身 Provider 适配函数。它不连接 MySQL、不加入 VPC、不配置任何 trigger，也不向客户端开放调用；只接受 `mip-ai-api` 的 `mip.ai.avatar-provider.v1` 完整 HMAC envelope，并代理 `generateDigitalAvatar`。

运行时必须配置：

- `MIP_ALLOWED_APP_IDS`
- `MIP_AI_AVATAR_PROVIDER_HMAC_SECRET`
- `MIP_AI_AVATAR_UPSTREAM_ENDPOINT`
- `MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS`
- `MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET`
- `MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS`（可选，默认 30000，范围 1000–45000）

内部 HMAC 与 AI 清理、草稿 Provider、上游 HTTP 鉴权分别使用独立密钥，运行时和部署前都会拒绝复用。请求固定为 `mip.ai.avatar-provider.v1`，签名覆盖版本、action、AppID、稳定 request ID、operation key、payload digest 和完整 payload；源图片的 CloudBase file ID、SHA-256、类型、字节数、宽高和风格全部绑定。函数下载私有源图后复核摘要、大小、PNG/JPEG 类型和尺寸，只向上游发送已验证的 base64 内容，不暴露 CloudBase file ID。

上游 Endpoint 只接受 HTTPS、443 端口、无凭证/查询/片段的 URL，hostname 必须精确出现在 allowlist。每次请求重新解析全部 DNS 结果并拒绝任一私网或保留地址，实际 TLS 连接固定到本次已验证地址；一个 wall-clock deadline 覆盖 DNS、请求和完整响应，重定向、压缩响应、超时和超限响应均被拒绝。上游鉴权通过 `Authorization: Bearer` 发送，函数日志、返回值和部署输出都不得包含鉴权值、源图、生成图或原始错误。

上游契约固定为 `mip.ai.avatar-upstream.v1`：

- readiness 请求：`{ version, action: "readiness", requestId }`；响应精确为 `{ version, requestId, ready: true }`。
- 生成请求：`{ version, requestId, operationKey, action, appId, payloadDigest, payload }`；`payload` 只包含 AppID、generation ID、稳定风格 key 和已验证源图。
- 生成响应：`{ version, requestId, operationKey, data }`；`data` 精确包含 `imageBase64`、`contentType`、`providerJobKey`。只接受不超过 2 MB、256–2048 像素、近方形的 PNG/JPEG；URL、额外字段、WebP、非规范 base64 和超限图片都会失败。

函数只在暖实例内合并正在执行的重复 operation，最多保留 4 个进行中任务，达到上限时失败而不驱逐任务，完成后立即释放图片响应；跨实例幂等由上游按 `Idempotency-Key` 和 payload digest 实现。最终图片仍会回到 `mip-ai-api` 完整解码、重新编码、执行微信图片内容安全检查并写入私有存储，Provider 不能直接声明资产或业务状态。

缺少 Endpoint、allowlist、内部 HMAC 或上游鉴权时 `health` 返回 `configured: false`，readiness 与业务请求均失败。运行时不存在复制原图或 mock 成功路径。只有真实上游已配置且 readiness 通过后才执行：

```bash
pnpm cloud:ai-avatar-provider:deploy -- --confirm-env=<EnvID> --confirm-function=mip-ai-avatar-provider
pnpm cloud:ai-avatar-provider:verify -- --confirm-env=<EnvID> --confirm-function=mip-ai-avatar-provider
```

部署顺序：先把 `MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME=mip-ai-avatar-provider` 配入本机，运行核心部署使 `mip-ai-api` 获得专用 HMAC 与超时配置；再部署和验证本函数。部署脚本在任何 Provider 写入前回读并证明该链接；新函数先以无密钥、未配置状态创建，立即关闭客户端调用并证明零 trigger，更新源码后才注入真实环境配置。任一步骤中断都不会留下带真实密钥且可由客户端调用的函数。
