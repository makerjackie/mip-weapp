---
name: mip-release
description: MIP 双环境部署与生产发布全流程 runbook：从预检、云端部署、构建上传、提审到发布后验证，含防呆清单与踩坑录。任何部署/发版动作前先读本文，按阶段推进不漏项。
---

# MIP 部署与发布 Runbook（双环境 · 防呆版）

环境事实：同一 CloudBase 环境，两套 MySQL 库 + 两套函数名。**生产 = `mip-*`（envs/prod）；测试 = `mip-t-*` + `mip_test` 库（envs/test）**。函数名/EnvID 构建期焊进包；支付模式与会员目录已服务端化（MIW-119），可热切不发版。

执行前遵循根 [AGENTS 测试验收与生产发布规则](../../../AGENTS.md#测试验收与生产发布用户2026-10-27确认)。本批先在测试环境复现、修复、回归并提供测试验收页；停在用户确认点。用户明确批准本批上线后，才可继续任何生产部署/生产包上传/提审/正式发布。环境确认参数和自动化检查通过不能代替该批准；生产复验后另给生产验收页并链接测试记录。

## 快捷命令速查

| 场景 | 命令 |
|---|---|
| 日常开发构建（测试包） | `pnpm build`（根 `.env.local` 默认 envs/test） |
| 发体验版 | `pnpm release:trial -- --desc "说明"` |
| **发正式版（唯一出口）** | `pnpm release:prod -- --desc "说明" --version X.Y.Z` |
| 部署云函数到测试 | `node scripts/ops.mjs --target=test` |
| 部署云函数到生产 | `node scripts/ops.mjs --target=production` |
| 支付模式热切换 | `node scripts/switch-payment-mode.mjs --mode=test\|live [--confirm-live]` |
| 全栈验证 | `node scripts/verify-cloud.mjs --confirm-env=<EnvID>`（MIP_ENV_DIR 指对目标） |
| 一次性 CAM 基建 | `./scripts/deploy-as-deployer.sh <命令>`（密钥在 .env.secrets.local，仅此入口） |

## 阶段 0 · 预检（每次部署/发版前，一项都不能跳）

- [ ] `git status` 干净、`git log origin/main..HEAD` 为空（未推送的代码不发版）
- [ ] 改动涉及云函数代码？→ 阶段 1 先部署 test；生产部分留到用户明确批准本批上线后执行
- [ ] 只改客户端？→ 跳过阶段 1 直接到阶段 2
- [ ] 改了数据库（新迁移）？→ `ops.mjs` 链内置迁移+备份门禁，勿单独跑 apply
- [ ] **判断包连哪个环境**：`grep -c "mip-t-identity-api" dist/common.js`（>0=测试包；0 且有 `mip-identity-api`=生产包）。微信"体验版/正式版"标签不算数。

## 阶段 1 · 云端部署（测试与生产分开，之间必须经过用户验收确认）

```bash
# 测试环境（函数已存在，标准身份即可）
MIP_ENV_DIR=envs/test CLOUDBASE_AUTH_MODE=local node scripts/ops.mjs --target=test
```

测试部署后继续完成本批回归、测试包和测试验收页，等待用户明确确认本批通过并允许上线。不要把下面的生产命令接在测试命令之后自动执行。

```bash
# 仅在用户明确批准本批上线后执行；确认参数不等于用户批准
MIP_ENV_DIR=envs/prod CLOUDBASE_AUTH_MODE=local node scripts/ops.mjs --target=production
```

- 链 = 迁移 dry-run → 备份 → 迁移 apply → project-init → 函数部署 → 授权收敛 → cloud:verify，任何一步红即停
- 支付三函数不在核心清单内：变更后单独 `node scripts/deploy-payment-function.mjs --confirm-...`；仅切模式用 switch 脚本
- **新建函数绑 VPC 需要 CAM 授权**（日常更新不需要）：走 `deploy-as-deployer.sh`（mip-deployer 子用户，密钥在 `.env.secrets.local`，勿复制他处）

## 阶段 2 · 构建与上传

- 用户确认前只允许连接测试环境的测试包；生产通道留待本批上线批准后。测试包上传和测试报告发布后先交付用户验收，不继续执行阶段 3/4。
- release 脚本内置：目录锁定（trial↔envs/test、prod↔envs/prod）→ `verify:all` 全绿门禁 → **烘焙函数名断言**（trial 包必须只含 mip-t-*，prod 包只含 mip-*）→ dist 平铺上传
- 生产通道先 fetch，要求干净且与 `origin/main` 一致的 `main`；门禁及构建后再次核对提交未变化。脚本自动注入 `BUILD_SHA` 并核对产物的 `buildSha`，不能把默认 `development` 标记当成发布证据。上传回执保存在忽略目录 `.tmp/release-prod-<version>.json`。
- 上传只产生开发版本。另行核实公众平台是否设为体验版、是否提审及是否公开发布，三者分别记录；CLI 成功和开发预览二维码都不能替代平台状态。若浏览器策略禁止访问公众平台，交接维护者操作，不换通道绕过禁令。
- 设置和关于显示的版本必须对应上传版本：发布脚本通过 `MIP_RELEASE_VERSION` 烘焙并校验，运行时优先读取微信 `miniProgram.version`；工程 `package.json` 版本不能代替发包版本。测试环境依据烘焙的函数目标，不能用微信「体验版」标签推断。
- 测试环境还须验证实际玩家成长页和 `getSnapshot`；`health` 正常、后台空列表成功不代表基础等级已配置。`cloud:verify` 会拒绝缺少 ACTIVE 零经验起始等级的库；不要用客户端假 Lv.1 掩盖配置缺失。
- 版本号规则：体验版默认 `0.2.0.YYYYMMDD`；正式版必须显式 `--version` 且语义化（首发 1.0.0，后续 1.0.N）
- 上传私钥缺失时走开发者工具 CLI（release 脚本通道）；私钥恢复后可回 `pnpm wechat:upload`

## 阶段 3 · 提审（人工，材料清单）

1. mp.weixin.qq.com → 版本管理 → 开发版本找到目标版本 → 提交审核
2. 向导：勾选平台规则 → 下一步 → 安全测试继续提交 → 接口未配置（wx.getLocation 未使用，勾选后继续）→ 隐私指引继续提交
3. 表单材料：演示视频 `~/Downloads/MIP-YANSHOU-VIDEO.mp4`；截图 `node scripts/fullpage-shot.mjs <页面路径>` 生成到 `.tmp/review-shots/`
4. 审核通过 → 全量发布

## 阶段 4 · 发布后验证（不过不算完）

- [ ] 仅适用于本批已获用户上线批准的生产阶段；完成后另发生产验收页并链接测试验收记录，保持原测试证据
- [ ] `MIP_ENV_DIR=envs/prod node scripts/verify-cloud.mjs --confirm-env=<EnvID>` 全绿
- [ ] 真机：打开线上版走通登录 → 活动列表 → **一笔真实会员购买**（live 支付+到账；可退）
- [ ] `docs/mip/PROJECT_STATUS.md` 记录本批（改了什么/门禁证据/遗留）
- [ ] notma 任务置 done + 时间线交付评论

## 防呆红线

- 生产凭证不进测试目录；测试目录不放支付商户/ASR/OpenAI/SMS 凭据
- 任何上传前 `verify:all` 必须全绿；烘焙断言失败立即停止（说明构建目录选错）
- 环境里的 `MIP_ENV_DIR` 与正在跑的命令目标不符时，ops/release 会拒绝——别绕过
- 提审包 = 生产函数名烘焙，这是发布前提
- 支付切 live 前确认：正式会员方案已建（LIVE 目录 ACTIVE）、商户号配置无误

## 踩坑录（真实发生过，遇到同款先看这里）

| 症状 | 根因与解法 |
|---|---|
| MCP 简单查询也报 "MCP tool returned an error response" | mcporter 守护进程重启后丢了环境绑定/状态劣化：`npx mcporter daemon stop && start`，必要时清孤儿进程 |
| 迁移报 "uncertain DDL step" | 上次进程中断留了 RUNNING 日志。幂等语句（CREATE TABLE IF NOT EXISTS）人工核验已生效后可补记 APPLIED；空库直接 DROP 重建更干净 |
| CreateFunction 报 vpc "has no permission" | 调用身份缺 VPC 资源授权，且 **MCP 不支持 CAM 密钥**。走 `deploy-as-deployer.sh`（SDK 直连）；注意 `QcloudTCBRFullAccess` 是云托管≠云开发 TCB |
| 上传报 PROJECT_CONFIG_JSON_NOT_VALID | 平铺工程 config 残留 `cloudfunctionRoot` 或用了相对路径：删该键 + 绝对路径重试 |
| architecture:check 报 macos-users | 并行会话在 gitignored 暂存容器（diff-work 等）写了本机绝对路径：确认该容器在检查器跳过列表里 |
| 长链中途 MCP 中断 | 迁移/部署均支持断点续跑，直接重跑命令；勿手工改库 |

## 下一步引导（对照当前位置）

- 代码刚合入 main → 阶段 0
- 云函数代码变了 → 阶段 1（test 先行）
- 只想给内测用 → 阶段 2 的 release:trial
- 要正式发版 → 阶段 2 的 release:prod → 阶段 3 → 阶段 4
- 只切支付/目录 → `switch-payment-mode.mjs`，不发版
