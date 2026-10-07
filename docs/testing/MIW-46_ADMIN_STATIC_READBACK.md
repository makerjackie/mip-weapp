# MIW-46 验收：静态托管回读校验修复（2026-10-07）

修复 `scripts/deploy-admin-cloudbase-static.mjs` 与新版 `@cloudbase/cloudbase-mcp`（仓库钉版 `2.32.3`，见 `config/mcporter.json`）响应结构的两处失配，恢复目录级回读校验主路径，保留逐文件 SHA-256 双保险。部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`）。

## 根因（两层，均以真实响应/源码取证）

| # | 根因 | 取证 |
| --- | --- | --- |
| R1 | `queryHosting(action="findFiles")` 的文件清单已移入 `data.result.Contents`（COS ListBucket 原始结构），`data.files` 恒为空数组、MCP 自带 message 也跟着报「共 0 个」；旧扁平 `data.files` 结构需兼容保留 | MIW-42..44 遗留证据 `.tmp/admin-cloudbase-static/inventory.private.json`：`files: []`，`result.Contents` 46 条；MCP 源码 `normalizeFileFields` 只接受数组 |
| R2 | `manageHosting(action="downloadDirectory")` 底层 SDK 经 CDN 域名 20 并发逐文件拉取，单文件失败被并行控制器静默吞掉（无返回值、无错误上抛），目录树可能缺文件——首轮实测丢 13/46（含当轮入口 `assets/index-D8bhUYBR.js`），复跑一轮 0/46 丢失，证实为随机性丢文件；顺序逐文件 `downloadFile` 实测全部成功 | MCP 源码 `HostingService.downloadDirectory` / `AsyncTaskParallelController.run`（`results[index] = err` 无检查）；探针差集与逐文件重下取证 |

## 修复内容

| # | 项 | 说明 |
| --- | --- | --- |
| F1 | 新增 `scripts/lib/admin-hosting-readback.mjs`：清单解析同时支持 `result.Contents` 嵌套（主路径）与旧扁平 `data.files`（降级并提示）；跟随 `IsTruncated/NextMarker` 分页；目录占位 key（零字节、以 `/` 结尾）不计入文件 | 兼容双结构，解析失败显式报错不静默 |
| F2 | 回读 #1（云清单核对）：上传后重新 `findFiles`，逐条核对清单内文件字节数与构建清单一致；断言清单无前缀外 key（共享根不变）且无 Cloudflare 元数据/`.map` 泄漏 | 输出 `cloudflareUnchanged`/`sharedRootUnchanged` 由实测计算 |
| F3 | 回读 #2（目录级回读恢复）：`downloadDirectory` 整树落盘后对照云清单查全，被 CDN 通道静默丢弃的 key 用顺序逐文件 `downloadFile` 补齐（计数 `directoryTopUps` 透明暴露），补齐后整树 SHA-256 与构建清单逐一比对 | 目录通道缺陷显式化，不回退为纯逐文件绕过 |
| F4 | 回读 #3（逐文件双保险保留）：对构建清单 14 文件逐个 `downloadFile` 并比对 SHA-256 | 与 MIW-34..40 的等效校验一致，作为独立第二层 |
| F5 | 新增 `tests/admin-static-readback.test.ts`（11 断言组）：嵌套/扁平/空清单/未知结构、分页推进、前缀隔离、Cloudflare 泄漏、清单差集、树差集、SHA-256 | 脚本此前零测试覆盖 |

## 验收

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实 staging 完整跑 `node scripts/deploy-admin-cloudbase-static.mjs --confirm-env=cloud1-d2gm0vloa9e1b4f31 --confirm-prefix=mip-admin-console/`（真实模式构建 `VITE_MIP_ADMIN_DEMO_MODE=false`） | ✅ | 输出 `{"filesVerified":14,"listingSource":"result-contents","listingFiles":46,"directoryReadbackFiles":46,"directoryTopUps":0,"perFileVerified":14,"status":"VERIFIED","cloudflareUnchanged":true,"sharedRootUnchanged":true}`；日志无解析降级提示 |
| C2 | 首轮失败被正确定位并修复（修复前同命令在目录树比对处报 `Static asset readback mismatch: assets/index-D8bhUYBR.js`，未误报 VERIFIED） | ✅ | 失败现场 → R2 取证 → F3 补齐机制 |
| C3 | 聚焦测试全绿 | ✅ | `npx vitest run tests/admin-static-readback.test.ts`：11 passed |
| C4 | `pnpm verify` 全量门禁 | ✅ | exit 0：256 测试文件 / 1527 测试全过（含本卡 11 项），lint/typecheck/build/server/docs 检查全绿 |
| C5 | 证据留存于 `.tmp/admin-cloudbase-static/`（0600）：`inventory`（上传前清单）、`readback-listing`（上传后清单+解析元数据）、`directory-download`（目录回读响应+丢弃清单+补齐计数）、`deploy`、`verified` | ✅ | 目录清单见本轮记录 |

## 遗留

- R2 的静默丢文件在 `@cloudbase/cloudbase-mcp` SDK 侧（CDN 并发拉取吞错），脚本侧已显式化补偿；若上游修复 `downloadDirectory` 返回逐文件结果，`directoryTopUps` 应自然归零，本脚本无需变更。
- 旧构建残留资产（历史入口 `index-D*.js` 等 32 个）仍在隔离前缀下，属既有状态；删除属独立决策，本卡不做。
