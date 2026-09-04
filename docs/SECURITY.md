# Security

- 仓库默认 `touristappid`
- 真实 AppID、EnvID、商户号、MySQL URI、ledger HMAC、证书不入库
- 客户端不得出现连接串或支付密钥
- 公开资料接口不得返回手机号、OpenID、完整票码
- 日志脱敏，见 `src/shared/errors.ts`
- CloudBase 管理命令只接受环境级 `CLOUDBASE_API_KEY`，放 `.env.local`，不要提交；按环境或设备分别创建，设备丢失或成员退出时立即撤销旧 Key。稳定运行时密钥和 MySQL URI 可放 `.env.secrets.local`，仅由 owner/deployer 或 CI 读取；云函数环境是运行副本。
- `MIP_WECHAT_APP_SECRET` 是微信服务端凭证，只保存在 `.env.local` 或受控 secret store，不得进入客户端构建产物。

```bash
pnpm security:check
```
