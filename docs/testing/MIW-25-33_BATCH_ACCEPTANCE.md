# MIW-25..33 批次验收 Checklist（2026-10-05）

本批次覆盖 7 个 review 状态任务合并、部署与端到端验收：MIW-25、MIW-26、MIW-27、MIW-28、MIW-29、MIW-31、MIW-33。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging，下文以 `<EnvID>` 指代）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 7 个任务分支全部提交并合并 main（合并冲突已解决：迁移 098 撞号重编为 099–101、会员配置面板双功能合并、测试双侧保留、PROJECT_STATUS 数字校正） | ✅ | main `ac2af843`，远端已同步 |
| A2 | `pnpm verify` 全绿（含隔离检查、安全检查、类型、lint、全量测试、构建、包体预算、文档合同） | ✅ | verify passed；member 物理分包 1.37MiB/1.8MiB，含依赖口径 1.94MiB/2.0MiB（预算随批上调并注明） |
| A3 | `pnpm admin:web:verify` 全绿（lint、类型、27 个测试文件 161 项 React 测试、构建、响应式合同） | ✅ | exit 0 |
| A4 | `git diff --check` 干净 | ✅ | 无空白错误 |

## B. 数据库与云函数部署

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 部署前仓库外逻辑备份（152 表 / 3217 行，行数一致性校验通过，保留在本机备份目录） | ✅ | backup complete: row-count-verified |
| B2 | 迁移 098（勋章管理字段）、099（成长规则说明）、100（邀请嘉宾表）、101（入会审批表）按序应用且 tracking 记录齐全 | ✅ | `[mip-schema] applied` ×4 + isolated schema verified |
| B3 | 目标库回读：`mip_badges.acquire_condition` / `mip_badges.image_asset_id` 列存在；`mip_growth_rules.description` 列存在；`mip_membership_invitation_guests`、`mip_membership_approvals` 表存在 | ✅ | information_schema 直查命中全部 5 项 |
| B4 | 16 个核心 `mip-*` 云函数部署并逐一健康验证（MySQL 持久化证明），无 timer、无客户端调用权限 | ✅ | `deployment verified; no ... secret was persisted`；首次因 STS 拒绝与 community-api 回读抖动各重试一次后通过 |
| B5 | `pnpm cloud:verify`：schema、最小权限授权、函数健康、受保护调用规则全部通过 | ✅ | verify-cloud 输出 verified |
| B6 | 匿名调用身份门控：`mip-growth-api` / `mip-events-api` / `mip-opportunities-api` 匿名 action 均返回结构化 `ok:false`，无运行时崩溃 | ✅ | invokeFunction ErrMsg 为空 + 结构化拒绝 |

## C. 管理后台（admin-web）部署与 HTTPS 验收

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false`）并上传静态托管隔离前缀 `mip-admin-console/`，14 个文件逐一 SHA-256 回读匹配 | ✅ | deploy 输出 status VERIFIED |
| C2 | BFF 函数 `mip-admin-web-api` 重新打包部署（本批含服务端素材上传通道变更） | ✅ | active、0 timer、客户端调用关闭 |
| C3 | 真实 HTTPS：`/` 返回 200 HTML 且引用资产与本地构建哈希一致（`index-BZwIcKel.js` 等） | ✅ | HTTP 200 text/html |
| C4 | 静态资产正确 MIME 与大小；缺失资产严格 404（不回落 SPA HTML） | ✅ | JS 200 text/javascript 454796B；缺失资产 HTTP 404 |
| C5 | API 路由：非信任 Origin 登录请求 403「请求来源无效」；可信 Origin + 错误密码 401 INVALID_CREDENTIALS（打到 MySQL 认证存储） | ✅ | HTTP 403 / 401 JSON |
| C6 | 登录后的管理业务写操作（勋章形象上传、获得条件保存、经验值规则文档保存、入会审核队列） | ⏳ | 本机未配置 `MIP_ADMIN_TEST_PHONE/PASSWORD`；React 合同测试 161 项已覆盖同一链路，建议配置后跑 `node scripts/verify-admin-cloudbase.mjs --origin=<EXACT_HTTPS_ORIGIN>` 或人工登录走查 |

## D. 小程序端（weapp）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | 合并后 `dist/` 重新构建并经微信开发者工具完整编译（preview 预览包）无错误 | ✅ | 总包 3.3MB / 主包 1.7MB / member 1.4MB / admin 134KB |
| D2 | `pnpm runtime:preflight` 全绿（真实 AppID、路由与 DevTools conditions 完整——含 MIW-27 新增经验值详情页路由、DevTools 登录态、服务端口） | ✅ | ok:true |
| D3 | 玩家等级页会员按钮分态、经验值详情独立页、规则说明后台文档（MIW-27） | ⏳ | 单测/合同测试通过；真机视觉与跳转待扫预览码走查 |
| D4 | 填写信息页一句话介绍计数 0/160 与四个区块图标字形（MIW-26） | ⏳ | 根工程测试通过；真机视觉待走查 |
| D5 | 活动详情已签到「与你互动」卡片：已签到展示（含 0/0）、未签到整卡隐藏、心动深链（MIW-28） | ⏳ | 服务端逻辑测试 + 真实匿名门控通过；需已签到账号真机验收 |
| D6 | 公开档案/案例/合作详情的等级徽章与出席胶囊、super case 默认底图（MIW-29） | ⏳ | 合同测试通过；真机视觉待走查 |
| D7 | 人才合作筛选：搜索行下方面板、DS chip、项目机会整页筛选保持（MIW-31） | ⏳ | 单测 + 服务端游标测试通过；真机交互待走查 |
| D8 | 我的名片 ABCD 详情页保真与底图、编辑器输入（MIW-33） | ⏳ | 根工程测试通过；真机视觉待走查 |
| D9 | 扫码进入 DevTools 预览二维码完成整包真机走查（D3–D8 汇总入口） | ⏳ | 预览码已生成，需手机扫码 |

## E. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 迁移 098–101 均带 rollback SQL 且入 lock；部署前备份在本机（含 manifest） | ✅ | rollback/098–101 存在；备份 manifest 校验通过 |
| E2 | 部署产物不含环境 ID、身份值或密钥；函数无新增 timer/权限 | ✅ | 部署脚本终检输出 |

## 遗留与后续

- MIW-30（勋章配置部署顺序）、MIW-32（与你互动真实数据验证）两个 todo 任务对应事项已在本轮提前完成（迁移先于函数发布；互动卡服务端已部署），任务单状态待维护者按其验收口径关闭。
- C6、D3–D9 为需人工/真机/测试账号的验收项，完成后在本文勾选补充。
- 支付、手机号授权、订阅消息、扫码签到未在本批变更范围内，未重新验收。
