---
name: mip-release
description: MIP 小程序双环境发布流程：日常/体验版走测试环境，正式版唯一出口是 release:prod。覆盖构建、上传、提审与发布后验证的完整口径。
---

# MIP 发布流程（方向 B 双环境）

环境事实（见 `docs/mip/ENVIRONMENTS.md`）：同一 CloudBase 环境，两个 MySQL 库、两套函数名。**生产 = 现有 `mip-*`（正式版已烘焙）；测试 = `mip-t-*` + `mip_test` 库**。函数名/EnvID/支付模式在构建时焊进包里，没有运行时开关——包连哪个环境，由它从哪个目录构建决定。

## 快捷命令

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 日常开发/预览 | `pnpm build`（根 `.env.local` 默认指向 envs/test） | 打测试包，随便造数 |
| 内测体验版 | `pnpm release:trial -- --desc "说明"` | 测试环境构建 → verify:all → 上传体验版 |
| **正式版（唯一出口）** | `pnpm release:prod -- --desc "说明" --version 1.0.N` | 生产构建 → verify:all → 上传 → 输出提审清单 |
| 部署测试云函数 | `node scripts/ops.mjs --target=test` | 迁移→备份→部署→授权→验证一条链 |
| 部署生产云函数 | `node scripts/ops.mjs --target=production` | 同链 + `--confirm-production/--confirm-live` 自动拼接 |

## 判断包连的哪个环境

构建后核对烘焙函数名（唯一可靠信号）：
`grep -c "mip-t-identity-api" dist/common.js`（>0 测试包；0 且有 `mip-identity-api` 生产包）。微信"体验版/正式版"标签与环境无关。

## 正式发布人工步骤（release:prod 之后）

1. mp.weixin.qq.com → 版本管理 → 开发版本找到新版本号 → **提交审核**
2. 向导确认链：勾选平台规则 → 下一步 → 安全测试继续提交 → 接口未配置（`wx.getLocation` 未使用，勾选后继续）→ 隐私指引继续提交
3. 提审表单：演示视频 `~/Downloads/MIP-YANSHOU-VIDEO.mp4`；截图 `.tmp/review-shots/`（可用 `node scripts/fullpage-shot.mjs <页面路径>` 补充）
4. 审核通过 → 全量发布 → 真机验证一笔 live 支付与会员到账
5. 回读验证：`MIP_ENV_DIR=envs/prod node scripts/verify-cloud.mjs --confirm-env=<EnvID>`

## 红线

- 生产凭证不进测试目录；测试目录不放支付商户/ASR/OpenAI/SMS 凭据
- 任何上传前完整 `pnpm verify:all` 必须全绿（release 脚本内置）
- 提审包烘焙生产函数名是发布前提；烘焙核对失败立即停止
- 上传私钥缺失时走已登录开发者工具 CLI（release.mjs 通道）；私钥文件恢复后可回 `pnpm wechat:upload`
