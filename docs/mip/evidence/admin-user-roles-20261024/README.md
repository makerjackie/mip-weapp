# MIW-130 四角色展示证据（2026-10-24）

## 背景

Q-ADMIN-09 2026-10-24 口径：匿名访客（未绑定手机号，或已授权手机号但未完善资料）/ 普通用户 / 嘉宾 / 玩家，由 `cloudfunctions/*/lib/product-role.js` 实时投影，后台用户列表/详情/筛选/导出与小程序「当前身份」统一。

本批截图为**演示模式**（`VITE_MIP_ADMIN_DEMO_MODE=true`，数据来自 `admin-web/src/services/demo-data.ts` 夹具），不代表生产事实。生产数据库只读统计见 `docs/mip/REQUIREMENT_CLARIFICATIONS.md` Q-ADMIN-09 数据核查结论（2026-10-24，生产 34 用户 / 测试 9 用户）。

## 截图清单

均通过 Playwright 对 demo-mode vite dev server 捕获，视口与内容如下：

| 文件 | 视口 | 内容 |
| --- | --- | --- |
| `desktop-users-list.png` | 1440×900 @2x | 用户管理默认列表：同一表格内可见 玩家 / 嘉宾 / 普通用户 / 匿名访客 四种当前角色，含新增夹具行「未填写昵称 / 未绑定 / 匿名访客」（USR-1005） |
| `desktop-users-anonymous-filter.png` | 1440×900 @2x | 身份筛选选择「匿名访客」并点击「筛 选」后，列表仅剩匿名访客一行 |
| `mobile-users-anonymous-filter.png` | 390×844 @2x | 手机视口同一筛选，表格横向滚动展示过滤结果行 |

## 环境

- 页面：admin-web `/#/users`（用户管理，U01）
- 构建：本地 `pnpm admin:web:dev` demo 模式，2026-10-24
- 无二维码、无真实用户数据；演示夹具脱敏
