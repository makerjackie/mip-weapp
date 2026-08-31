# mip-ai-draft-provider

独立的 AI 草稿 Provider 适配函数。它不连接 MySQL、不加入 VPC、不安装 timer，只接受 `mip-ai-api` 的版本化完整 HMAC envelope，并代理三个固定动作：`structureText`、`transcribeAndStructure`、`refineDraft`。

运行时必须配置共同边界：

- `MIP_ALLOWED_APP_IDS`
- `MIP_AI_DRAFT_PROVIDER_HMAC_SECRET`
- `MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS`（可选，默认 8000，范围 500–10000）

上游二选一：

- OpenAI-compatible：`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_API_KEY`
- 旧版 MIP 协议：`MIP_AI_DRAFT_UPSTREAM_ENDPOINT`、`MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS`、`MIP_AI_DRAFT_UPSTREAM_SECRET`

OpenAI-compatible 模式使用 `${OPENAI_BASE_URL}/chat/completions`，启用 JSON mode、non-thinking、固定单结果和总超时。API Key 只注入本函数，不进入 `mip-ai-api` 或小程序。响应必须正常结束并返回纯 JSON；机会草稿严格限制为 `title`、`valueSummary`、`cityLabel`、`targetSummary`、`description` 五个字符串字段，不从原文之外推断事实。该模式只处理文字整理与补充整理；语音转写仍需旧版 MIP 上游提供。

Endpoint 或 Base URL 只接受 HTTPS、443 端口、无凭证/查询/片段的 URL。旧版 hostname 必须精确出现在 allowlist；OpenAI-compatible 模式只连接 Base URL 的精确 hostname。每次调用重新解析全部 DNS 结果并拒绝任一私网或保留地址，实际 TLS 连接固定使用本次已验证地址；重定向、压缩响应、超时、超过 64 KB 的响应均被拒绝。

语音动作先从当前 CloudBase 环境下载签名请求指定的私有 MP3，复核 SHA-256、字节数、类型和文件头，再只向白名单 Endpoint 发送音频内容，不暴露 CloudBase file ID。上游必须回显版本、稳定 request ID 和 operation key；`Idempotency-Key` 同时作为 HTTP header 传递。函数内只提供暖实例内的并发合并与短期冲突检测，跨实例幂等由上游按 operation key 实现。

上游请求统一使用 `mip.ai.draft-upstream.v1`。readiness 请求为 `{ version, action: "readiness", requestId }`，响应必须精确为 `{ version, requestId, ready: true }`。三个业务动作接收 `{ version, requestId, operationKey, action, appId, payloadDigest, payload }`，响应必须精确为 `{ version, requestId, operationKey, data }`；`data` 对文本/语音包含 `transcriptText`、`structuredDraft`、`providerJobKey`，对补充整理只包含 `structuredDraft`、`providerJobKey`。上游必须按 HTTP `Idempotency-Key` 对相同 operation key 和 payload digest 返回同一结果，并拒绝同 key 不同 digest。

缺少 Endpoint、allowlist 或密钥时 `health` 显示 `configured: false`，`readiness` 和业务动作均失败，不存在 mock 成功路径。`readiness` 会使用同一鉴权密钥调用上游的 `mip.ai.draft-upstream.v1` readiness 契约，并要求精确回显 request ID；仅 DNS 可解析不算可用。独立部署与验收入口：

```bash
pnpm cloud:ai-draft-provider:deploy -- --confirm-env=<EnvID> --confirm-function=mip-ai-draft-provider
pnpm cloud:ai-draft-provider:verify -- --confirm-env=<EnvID> --confirm-function=mip-ai-draft-provider
```

部署前先在本地配置上游并把 `MIP_AI_PROVIDER_FUNCTION_NAME` 设为
`mip-ai-draft-provider`，然后部署 `mip-ai-api`。Provider 部署脚本会在任何写入前读取
已部署 AI API 的环境并确认函数名和专用 HMAC 已完成链接。
