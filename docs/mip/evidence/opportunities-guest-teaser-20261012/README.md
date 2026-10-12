# 机会 Tab 非玩家 teaser 证据（MIW-70，2026-10-12）

figma 3828:26439（机会-项目机会 非玩家的-已登录）/ 3828:27376（机会-人才合作 非玩家的-已登录）：嘉宾（已登录非玩家）在机会 Tab 两个子页都不再看到项目机会/人才 list，整块换成 Mystery Box + 「去成为玩家解锁权限>」teaser。

## 截图（开发者工具整页截图，`scripts/fullpage-shot.mjs` + fixture 注入）

| 文件 | 场景 | 期望 |
| --- | --- | --- |
| `opp-tab-guest.png` | 项目机会 tab，`authenticated:true / player:false` | pills 行 + Mystery Box + 解锁文案，无玩家登录按钮、无 list |
| `coop-tab-guest.png` | 人才合作 tab（`?mode=cooperation`），同上 | 搜索/筛选行 + Mystery Box + 解锁文案，无 list |
| `opp-tab-anon.png` | 未登录回归（`authenticated:false`） | 沿用 2198_44284：Box + 玩家登录 + 解锁文案，不回归 |
| `coop-tab-player.png` | 玩家回归（`player:true`） | 不出 teaser，落人才空态（无后端 fixture 环境无数据） |

截图内「机会服务暂时不可用」为无云后端 fixture 会话的列表加载失败提示，生产正常环境不出现。

## 几何核对（截图实测 vs figma）

- 容器锚行：项目机会 pills 底 168 → Box 图框顶 210 = 84rpx；人才合作搜索行底 180 → 210 = 60rpx（新 `mt-[60rpx]`）。
- 解锁文案：Box 图框底 390 → 文案顶 406（项目机会，`mt-4`=16css）/ 414（人才合作，`mt-[48rpx]`=24css）。
- 截图实测（363px 宽，scale 0.968，扣除 `guest-mystery-box.png` 自带 ~25.6% 顶部透明边距 46css）：项目机会 42.8css（期望 42）、人才合作 31.5css（期望 30）、文案间距 21.6/29.8css（期望 16/24 + 字形升部 ~5）。均在阈值测量误差内。

## 测试

- `tests/mip-opportunity-journey-review.test.ts`：teaser 条件改 `!player`、玩家登录胶囊仅 `!authenticated`、两个 list 渲染门槛 `player`、teaser 几何类断言（MIW-70 新增块）。
- 根工程 `pnpm verify` 全绿（typecheck + lint + build + vitest + node:test + docs:check）。
