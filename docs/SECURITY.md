# Security

- 仓库默认 `touristappid`
- 真实 AppID、EnvID、商户号、MySQL URI、ledger HMAC、证书不入库
- 客户端不得出现连接串或支付密钥
- 公开资料接口不得返回手机号、OpenID、完整票码
- 日志脱敏，见 `src/shared/errors.ts`

```bash
pnpm security:check
```
