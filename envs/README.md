# 目标环境目录（测试 / 生产）

方向（2026-10-15 拍板，见 [docs/mip/ENVIRONMENTS.md](../docs/mip/ENVIRONMENTS.md)）：**现有全部资源原地转生产；测试环境全部新建**。本目录承载两套目标的本地配置，彼此独立、互不复制。

## 结构

```
envs/
  prod/   生产目标（现有 CloudBase 环境 + 默认 mip-* 函数集 + admin.mip.cool）
  test/   测试目标（同实例第二库 + mip-t-* 函数集 + admin-test.mip.cool）
```

每个目标目录内放置两份被 Git 忽略的文件（模板见各自 `env.example`）：

- `.env.local` —— 非密钥配置：EnvID、全套函数名、stage/catalog/payment、`MIP_DB_SCHEMA`（仅测试目录填写）
- `.env.secrets.local` —— 密钥：API Key、连接 URI、HMAC/加密密钥等（权限 600）

## 使用

所有命令通过 `MIP_ENV_DIR` 选择目标；编排入口会自动设置并校验：

```bash
# 一条命令跑完整链（迁移 dry-run → apply → project:init → grants → deploy → verify）
node scripts/ops.mjs --target=test
node scripts/ops.mjs --target=production

# 小程序构建同理（函数名/EnvID/支付模式按目录烘焙进产物）
MIP_ENV_DIR=envs/test pnpm build
```

不设置 `MIP_ENV_DIR` 时回落到仓库根 `.env.local`（当前指向现有生产环境）。

## 红线

- 生产凭证不得复制进测试目录，任何凭证不得进入 Git、小程序包或验收站。
- 测试目录不放支付商户（`WECHAT_PAY_MERCHANT_ID`）、ASR/OpenAI/SMS 凭据——测试环境的 AI/短信/支付上游能力自动关闭。
- 两套 admin 后台的会话密钥与 HMAC 各自独立，不跨环境复用。
- 每次上传前完整 `pnpm verify:all` 门禁不变；上传哪个环境，就先核对构建产物中烘焙的函数名。
