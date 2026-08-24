# MIP 验收矩阵

验收分为静态、本地行为、运行时、共享云环境和真机/生产五层。任何一层没有证据时保留“待验收”，不能用另一层通过代替。覆盖矩阵中的 `implemented-local` 只代表本地代码证据，不代表产品验收；需要外部环境的项目统一使用 `external-wait`。

## 当前本地证据

以下是当前工作区已有的聚焦证据，未包含微信开发者工具、CloudBase 部署、正式配置或真机结论：

| 能力 | 本地证据 | 本地结论 |
| --- | --- | --- |
| A1/A4 全局协议门禁与冷启动恢复 | `tests/mip-identity-flow.test.ts`、`src/modules/mip-identity/global-access.ts` | `implemented-local`；正式协议为 `external-wait` |
| B1–B8 活动首页、筛选、分页和分享 | `src/pages/events/index.ts`、`src/pages/events/index.wxml`、`tests/mip-events-date-range.test.ts` | `implemented-local`；视频号、正式内容和真机日历为 `external-wait` |
| C1–C7 活动详情、参与人、邀请来源和原生动作 | `cloudfunctions/mip-events-api/tests/public-contract.test.js`、`tests/mip-event-rich-content.test.ts`、`tests/mip-event-native-actions.test.ts` | `implemented-local`；媒体、地图、拨号、码图和相册为 `external-wait` |
| C8 支付报名 | `tests/mip-commerce.test.ts`、`tests/event-registration-experience.test.ts`、`cloudfunctions/mip-payment-ledger/tests/ledger.test.js` | 源码链路已实现；正式商户、回调和真机支付为 `external-wait` |
| D1–D4 扫码、恢复与签到海报 | `tests/mip-checkin-poster.test.ts`、`cloudfunctions/mip-events-api/tests/checkin-poster.test.js`、`cloudfunctions/mip-events-api/tests/invitation-scene.test.js` | 源码链路已实现；真实小程序码、真机扫码、Canvas 和相册为 `external-wait` |
| D5–D7 心动历史与反馈 | `cloudfunctions/mip-events-api/tests/heart-history.test.js`、`src/packages/member/mip-hearts/index.ts`、`tests/mip-event-feedback-admin.test.ts` | `implemented-local` |
| D8 通知 | `tests/mip-messaging-ai.test.ts`、`cloudfunctions/mip-notification-worker/tests/templates-routes.test.js` | 站内 outbox 为 `implemented-local`；正式模板与微信投递为 `external-wait` |
| E2 全局/玩家范围、角色/行业/能力筛选 | `tests/mip-people.test.ts`、`cloudfunctions/mip-opportunities-api/tests/people-discovery.test.js`、机会页模块测试 | `implemented-local` |
| E3 机会详情发布时间与团队呈现 | `src/packages/member/mip-opportunities/detail/index.ts`、`src/packages/member/mip-opportunities/detail/index.wxml` | `implemented-local` |
| E4 机会团队成员 | `cloudfunctions/mip-opportunities-api/tests/opportunity-team.test.js`、`tests/mip-opportunities.test.ts` | `implemented-local` |
| E5 指定被引荐人 | `cloudfunctions/mip-opportunities-api/tests/referral-targets.test.js`、`tests/mip-related-opportunities.test.ts` | `implemented-local`，部署与真机为 `external-wait` |
| F4 我发布 / 引荐给我 | `tests/mip-related-opportunities.test.ts`、`cloudfunctions/mip-opportunities-api/domain/received-interactions.js` | `implemented-local`，云端运行时为 `external-wait` |
| 合作卡预览前自动保存 | `tests/mip-cooperation-preview.test.ts`、`src/packages/member/mip-cooperation/editor/index.ts` | `implemented-local` |
| 合作卡/超级案例软归档与多轮 AI | `tests/mip-content-archive.test.ts`、`tests/mip-ai-multiturn.test.ts` | CRUD 和草稿链路为 `implemented-local`；真实 AI provider 为 `external-wait` |
| 多公司/组织经历 | `tests/mip-profile-organizations.test.ts`、`src/packages/member/mip-profile/organization-editor.ts` | `implemented-local`，隐私展示运行时为 `external-wait` |
| 活动日期范围和可见日期标签 | `tests/mip-events-date-range.test.ts`、`cloudfunctions/mip-events-api/tests/date-range.test.js`、`src/pages/events/index.ts` | `implemented-local` |
| 平台默认取消规则 | `cloudfunctions/mip-events-api/tests/cancellation-policy.test.js`、`cloudfunctions/mip-admin-api/tests/event-policy.test.js` | `implemented-local`，正式配置为 `external-wait` |
| 活动介绍媒体上传、排序、预览 | `tests/admin-events.test.ts`、`cloudfunctions/mip-admin-api/tests/event-content-media.test.js`、`tests/mip-event-rich-content.test.ts` | `implemented-local`，真机媒体链路为 `external-wait` |
| 手机号更换 | `cloudfunctions/mip-identity-api/domain/handler.js`、`cloudfunctions/mip-identity-api/tests/service.test.js` | 本地已覆盖微信验证和重复绑定拒绝；真机为 `external-wait` |
| 机会兴趣/引荐唯一关系 | `tests/mip-related-opportunities.test.ts`、`cloudfunctions/mip-opportunities-api/tests/block-visibility.test.js` | `implemented-local`，云端部署和运行时为 `external-wait` |
| N1 会员期邀请归因与载体 | `tests/mip-membership-invitation-ui.test.ts`、`cloudfunctions/mip-commerce-api/tests/membership-invitation-code.test.js`、`cloudfunctions/mip-commerce-api/tests/repository.test.js` | `implemented-local`；正式 wxacode、扫码和相册为 `external-wait` |
| 谁看过我 | `database/mysql/mip/023_profile_visits.sql`、`cloudfunctions/mip-opportunities-api/tests/profile-visits.test.js`、`src/packages/member/mip-received/index.ts` | `implemented-local`；云端运行时为 `external-wait` |
| 管理端 `cloud://` 图片解析 | `tests/cloud-media.test.ts`、`src/modules/mip-admin/cloudbase-gateway.ts` | `implemented-local`；真实临时 URL 和下载失败恢复为 `external-wait` |
| H1 用户详情与导出 | `cloudfunctions/mip-admin-api/tests/service.test.js`、`cloudfunctions/mip-admin-api/tests/export.test.js` | `implemented-local`；CloudBase 私有文件运行时为 `external-wait` |
| H2 订单与参与名单 | `tests/admin-orders-roster-h2.test.ts`、`tests/admin-roster.test.ts` | `implemented-local`；正式支付退款为 `external-wait` |
| H3 多范围角色和管理登录审计 | `tests/admin-rbac-scope-h3.test.ts`、`cloudfunctions/mip-admin-api/tests/capabilities.test.js` | `implemented-local` |
| H4 成长等级、规则、流水与调整 | `tests/mip-growth.test.ts`、`cloudfunctions/mip-admin-api/tests/growth-rule-catalog.test.js` | `implemented-local`；正式数值为 `external-wait` |

## 静态门禁

- `pnpm verify`
- `git diff --check`
- 页面只能经过 modules 和 platform 调用服务端。
- 活跃 MIP 代码不得读写 `member_*`、`dating_*`、`sewing_*`。
- 迁移只新增 `mip_*` 对象并写 `mip_schema_migrations`。
- 部署清单只有 `mip-*`，存储路径只有 `mip/`。
- 金额、会员、报名、签到、成长和权限判断均有服务端测试。

以下事项即使本地测试通过，仍保留 `external-wait`：正式 AppID、CloudBase 核心函数部署与运行时健康、支付商户和回调、正式协议正文、正式标签/城市和 AME 配置、通知模板、AI provider、活动介绍图片的真机选择/上传/内容安全/临时 URL、手机号、扫码签到、地图/日历和真实支付。当前 23 个数据库迁移已经成功应用，不再列为 `external-wait`。

## 微信开发者工具

- `pnpm runtime:preflight`
- `pnpm test:runtime`
- 四个主 Tab：发现、活动、机会、我的。
- 公开浏览、登录恢复来源、页面返回和深链退出路径。
- 代表页面在 375px 画布与长内容下无裁切、重叠和不可达操作。
- loading、empty、error、forbidden、conflict、disabled 状态均可触达。
- 设计截图与 [FIGMA_MAP.md](FIGMA_MAP.md) 的代表 frame 对照。
- 机会筛选能在“全局搜索/只搜玩家”之间切换，角色、行业、能力和城市筛选确认后结果与空状态一致。
- 发布机会能选择、移除并保存团队成员；引荐能选择、替换和取消被引荐人；“我发布”和“引荐给我”分别打开正确详情。
- 档案能分别增删、排序和保存公司/组织经历；公开展示遵守每项隐私设置。
- 活动日期范围覆盖单日、起止日、单侧日期、反向区间和无效日期；活动介绍媒体覆盖上传、排序、预览、移除和错误恢复。
- 活动首页在单日、起止日和单侧日期筛选后显示与当前条件一致的中文日期标签。
- 合作卡点击“预览”先保存当前字段；保存失败时停留编辑页并保留输入。
- 机会详情展示发布时间、团队成员和默认封面；进入公开档案只使用 opaque profile reference。
- 进入他人公开档案只记录一次页面访问意图；访客列表按最新访问排序并显示累计次数、未读和本人读取状态。
- 管理端列表中的 `cloud://` 图片先解析为临时可显示 URL，解析失败时保留页面错误恢复，不把文件 ID 当作图片地址展示。

## 共享 CloudBase

### 当前事实

| 验收项 | 当前证据 | 状态 |
| --- | --- | --- |
| 23 个 `mip_*` 迁移 | 锁定迁移已成功应用，版本和对象清单已核对 | 云端已验证 |
| 数据库隔离 | 迁移后检查通过，只写入 `mip_*` 与 `mip_schema_migrations` | 云端已验证 |
| 开发者工具登录 | 已登录并可看到云函数列表 | 只证明可见性 |
| `mip-identity-api` | 已创建空函数壳 | `external-wait`；VPC、子网、环境变量、仓库代码和 MySQL 健康未完成 |
| 13 个核心函数 | 当前 API Key 缺少 SCF 创建/更新配置和目标 VPC/子网权限 | `external-wait` |

`managePermissions` 只能修改 CloudBase 函数的客户端安全规则，不能修改 CAM 或补 `cam:PassRole`。下一步由主账号扫码完成 CloudBase 服务授权，或提供符合 [CloudBase 最小权限清单](../CLOUDBASE.md#当前部署阻塞与最小人工动作) 的专用 CAM 部署身份。

新环境或后续新增迁移首次写入前必须：

1. 保留仓库外数据库备份及校验清单；
2. 再取一次变更前备份，记录是否为稳定行数快照；
3. 预览 SQL，确认所有新增表以 `mip_` 开头；
4. 查询现有表行数和结构摘要，变更后复核非 `mip_*` 对象未变化；
5. 只部署 `mip-*` 函数，不安装高频通知定时器。

当前数据库证据已经包含迁移版本和 MIP 对象清单。剩余云端证据必须包含：13 个核心函数清单、每个函数的 VPC/环境变量配置回读、专用 runtime MySQL 账号、只读健康检查、客户端调用规则、高频 timer 缺失检查和一组 `is_demo=1` 端到端夹具。不得在共享旧表中造演示数据。空函数壳、开发者工具可见或 API Key 为 `READY` 均不能替代这些证据。

## 真机或生产环境

以下能力不能只靠开发者工具判定完成：

| 能力 | 必须证据 |
| --- | --- |
| 手机号 | 真机 `getPhoneNumber`、换绑、重复手机号和来源页恢复 |
| 支付 | 正式商户下单、回调、查单、退款和权益生效 |
| 订阅消息 | 模板申请、逐次授权、发送和授权消耗 |
| 扫码签到 | 真机扫码、未登录、未报名、重复扫码、过期和跨活动 |
| 相册/封面 | 真机选择、上传、内容安全、临时 URL 和失败清理 |
| 日历与地图 | 真机加入系统日历、拒绝授权、打开地图和无坐标时复制地址 |
| AI 语音 | 真机录音权限、上传、转写、草稿确认和音频清理 |

## 需求追踪

每个纵向切片在提交前更新本表或对应测试说明，至少覆盖：

- 身份与分会；
- 会员、订单和支付；
- 活动、报名、邀请和签到；
- 心动与反馈；
- 机会、引荐和感兴趣；
- 合作卡、超级案例和 AI 草稿；
- 成长体系；
- 站内消息和微信 adapter；
- 平台、城市和活动权限；
- 管理端查询、脱敏、导出和审计。
