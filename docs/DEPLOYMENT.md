# Deployment

1. 配置 AppID 与 CloudBase EnvID
2. `pnpm database:setup -- --confirm-env=<EnvID>`
3. `pnpm cloud:deploy -- --confirm-env=<EnvID>`
4. 绑定微信支付并部署支付函数
5. `pnpm admin:bootstrap`
6. 微信后台配置服务器域名、业务域名、用户隐私协议
7. 上传与提审

发布前：`pnpm verify`。真实支付与真机能力见 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md)。
