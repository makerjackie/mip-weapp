# MIP 验收矩阵

验收分为静态、本地行为、运行时、共享云环境和真机/生产五层。任何一层没有证据时保留“待验收”，不能用另一层通过代替。覆盖矩阵中的 `implemented-local` 只代表本地代码证据，不代表产品验收；需要外部环境的项目统一使用 `external-wait`。

## 当前本地证据

以下表格只列当前工作区的聚焦本地证据；微信开发者工具、共享 CloudBase、正式配置和真机结论在后续章节单独记录：

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
| N4 行业/城市共用选择器 | `src/components/catalog-selector/`、`tests/mip-catalog-selector.test.ts`、档案/人才/机会三个调用页 | `implemented-local`；正式标签为 `external-wait` |
| E3 机会详情发布时间与团队呈现 | `src/packages/member/mip-opportunities/detail/index.ts`、`src/packages/member/mip-opportunities/detail/index.wxml` | `implemented-local` |
| E4 机会团队成员 | `cloudfunctions/mip-opportunities-api/tests/opportunity-team.test.js`、`tests/mip-opportunities.test.ts` | `implemented-local` |
| E5 指定被引荐人 | `cloudfunctions/mip-opportunities-api/tests/referral-targets.test.js`、`tests/mip-related-opportunities.test.ts` | `implemented-local`；微信补充通知为 `external-wait` |
| F4 我发布 / 引荐给我 | `tests/mip-related-opportunities.test.ts`、`cloudfunctions/mip-opportunities-api/domain/received-interactions.js` | `implemented-local`，云端运行时为 `external-wait` |
| 合作卡预览前自动保存 | `tests/mip-cooperation-preview.test.ts`、`src/packages/member/mip-cooperation/editor/index.ts` | `implemented-local` |
| 合作卡/超级案例软归档与多轮 AI | `tests/mip-content-archive.test.ts`、`tests/mip-ai-multiturn.test.ts` | CRUD 和草稿链路为 `implemented-local`；真实 AI provider 为 `external-wait` |
| 多公司/组织经历 | `tests/mip-profile-organizations.test.ts`、`src/packages/member/mip-profile/organization-editor.ts` | `implemented-local`，隐私展示运行时为 `external-wait` |
| 活动日期范围和可见日期标签 | `tests/mip-events-date-range.test.ts`、`cloudfunctions/mip-events-api/tests/date-range.test.js`、`src/pages/events/index.ts` | `implemented-local` |
| 平台默认取消规则 | `cloudfunctions/mip-events-api/tests/cancellation-policy.test.js`、`cloudfunctions/mip-admin-api/tests/event-policy.test.js` | `implemented-local`，正式配置为 `external-wait` |
| 活动介绍媒体上传、排序、预览 | `tests/admin-events.test.ts`、`cloudfunctions/mip-admin-api/tests/event-content-media.test.js`、`tests/mip-event-rich-content.test.ts` | `implemented-local`，真机媒体链路为 `external-wait` |
| 手机号更换 | `cloudfunctions/mip-identity-api/domain/handler.js`、`cloudfunctions/mip-identity-api/tests/service.test.js` | 本地已覆盖微信验证和重复绑定拒绝；真机为 `external-wait` |
| 机会兴趣/引荐唯一关系 | `tests/mip-related-opportunities.test.ts`、`cloudfunctions/mip-opportunities-api/tests/block-visibility.test.js` | `implemented-local`；端到端运行时和微信补充通知为 `external-wait` |
| N1 会员期邀请归因与载体 | `tests/mip-membership-invitation-ui.test.ts`、`cloudfunctions/mip-commerce-api/tests/membership-invitation-code.test.js`、`cloudfunctions/mip-commerce-api/tests/repository.test.js` | `implemented-local`；正式 wxacode、扫码和相册为 `external-wait` |
| 谁看过我 | `database/mysql/mip/023_profile_visits.sql`、`cloudfunctions/mip-opportunities-api/tests/profile-visits.test.js`、`src/packages/member/mip-received/index.ts`、`tests/mip-received-interactions.test.ts` | 访客列表及“我的”未读入口为 `implemented-local`；云端运行时为 `external-wait` |
| 小程序端 `cloud://` 图片解析 | `tests/cloud-media.test.ts`、`tests/mip-commerce-cloud-media.test.ts`、`src/modules/platform/cloud-media.ts` | 管理端和会员订单均在传输层解析临时 URL；当前活动订单封面已在开发者工具验证，下载失败恢复仍需专项验收 |
| H1 用户详情与导出 | `cloudfunctions/mip-admin-api/tests/service.test.js`、`cloudfunctions/mip-admin-api/tests/export.test.js` | `implemented-local`；生产环境不含手机号的零行导出已通过文件完整性和消费验证，含真实敏感行及手机号的导出仍需受控证据 |
| H2 订单与参与名单 | `tests/admin-orders-roster-h2.test.ts`、`tests/admin-roster.test.ts` | `implemented-local`；正式支付退款为 `external-wait` |
| H3 多范围角色和管理登录审计 | `tests/admin-rbac-scope-h3.test.ts`、`cloudfunctions/mip-admin-api/tests/capabilities.test.js` | `implemented-local` |
| H4 成长等级、规则、流水与调整 | `tests/mip-growth.test.ts`、`cloudfunctions/mip-admin-api/tests/growth-rule-catalog.test.js` | `implemented-local`；正式数值为 `external-wait` |
| H5 NPC 任务派发、等级、模板与截止 | `database/mysql/mip/027_task_assignments_templates.sql`、`database/mysql/mip/038_task_level_rules.sql`、`cloudfunctions/mip-tasks-api/tests/task-contract.test.js`、`tests/mip-tasks.test.ts` | 指定成员与成长等级双重资格、服务端当前经验重验、版本保护和审计已完成；真机模板上传/保存为 `external-wait` |
| 固定 PRD #55 玩家 VIP 页 | `src/packages/member/mip-growth/index.ts`、`tests/mip-growth-vip.test.ts`、`tests/mip-membership-invitation-ui.test.ts`、`config/runtime-pages.json` | 成长页邀请复用服务端会员 token，续费进入统一会员方案，分享已纳入真机契约；真实分享与支付为 `external-wait` |
| 固定 PRD #56 订单使用状态 | `cloudfunctions/mip-commerce-api/tests/repository.test.js`、`tests/mip-order-service-status.test.ts`、`src/packages/member/orders/index.ts` | 活动、会员和内容订单由服务端投影 `serviceStatus`，客户端只按权威值显示和筛选；正式支付/退款与真机状态为 `external-wait` |
| 勋章收藏、佩戴与运营管理 | `database/mysql/mip/028_badge_collection.sql`、`cloudfunctions/mip-growth-api/tests/badges.test.js`、`cloudfunctions/mip-admin-api/tests/badges.test.js`、`tests/mip-badges.test.ts` | 本人收藏、最多 3 枚佩戴、公开档案投影、运营目录/授予和迁移已完成；当前 3 枚演示勋章使用研究包内可替换的 MIP 立体素材，正式勋章目录与图片仍为 `external-wait` |
| 数字分身与我的名片 | `database/mysql/mip/030_digital_avatar_generations.sql`、`cloudfunctions/mip-ai-api/tests/avatar-store.test.js`、`cloudfunctions/mip-identity-api/tests/profile-card-code.test.js`、`tests/mip-digital-avatar.test.ts`、`tests/mip-member-card.test.ts` | 生成任务、服务端资产归属、原图/数字分身切换、Figma 名片背景和 AppID 绑定的 opaque scene 小程序码已完成；当前账号已生成可显示码，真实生成 provider、扫码、分享和相册保存为 `external-wait` |
| 运营消息活动 | `database/mysql/mip/031_message_campaigns.sql`、`cloudfunctions/mip-admin-api/tests/message-campaigns.test.js`、`tests/mip-message-campaigns.test.ts` | 平台/分会范围、收件人快照、幂等发布、撤回和审计已完成；外部微信投递为 `external-wait` |
| 游戏币、等级与弹窗消息 | `database/mysql/mip/032_game_coin_safety.sql`、`cloudfunctions/mip-growth-api/tests/game-coins.test.js`、`tests/mip-popup-messages.test.ts`、`tests/mip-outbox.test.ts` | 权威余额、追加流水、防负、周赛固定奖励、真实跨级识别、站内消息和弹窗去重已完成；微信模板和云端运行时为 `external-wait` |
| Owner 可配置角色权限 | `database/mysql/mip/033_configurable_rbac.sql`、`cloudfunctions/mip-admin-api/tests/role-capability-policies.test.js`、`tests/mip-configurable-rbac.test.ts` | 六类非 Owner 角色的白名单策略、版本冲突、恢复默认、安全上限、事务内二次授权和审计已完成；Owner 权限固定 |
| 机会评论、评价与打 call | `database/mysql/mip/034_opportunity_comments.sql`、`cloudfunctions/mip-opportunities-api/tests/comments.test.js`、`tests/mip-opportunity-comments.test.ts` | 用户评论/评价、参与人标识、编辑/软删除、打 call、举报、双向屏蔽及运营配置/审核已完成 |
| 热点、知识内容、评论与单内容付费 | `database/mysql/mip/036_mip_knowledge_content.sql`、`cloudfunctions/mip-community-api/tests/knowledge.test.js`、`cloudfunctions/mip-commerce-api/tests/knowledge-content.test.js`、`cloudfunctions/mip-payment-ledger/tests/knowledge-content.test.js`、`cloudfunctions/mip-admin-api/tests/knowledge.test.js`、`tests/mip-knowledge.test.ts` | 内容目录、搜索筛选、受保护详情、显式采集、审核、评论、CONTENT 订单、权益和退款边界为 `implemented-local`；正式源/内容/价格、业务域名、视频号和真实支付为 `external-wait` |
| 固定 PRD #60–#68 团队 PK、赛季、排行与队伍大本营 | `database/mysql/mip/029_gamification_foundation.sql`、`cloudfunctions/mip-game-api/tests/game.test.js`、`tests/mip-game.test.ts`、`src/packages/member/mip-game/`、`src/packages/admin/game/` | 有效会员门禁、服务端计分、周赛历史、四类排行快照、城市筛选、中性大本营状态和迁移已完成；正式规则、数据与视觉为 `external-wait` |

## 静态门禁

2026-08-31 当前工作区完整静态门禁通过：客户端 242 个测试文件、1370 项测试；服务端 263 个测试文件；源码合同为 125 个页面视图、16 个核心函数、58 个锁定迁移。架构、共享数据库隔离、安全、类型、lint、样式、构建、包体和文档链接同时通过，ESLint 为 0 warning、0 error。staging 已应用 58 个迁移并完成核心函数与权限读回；静态门禁和 staging 读回仍不等于真机或正式生产证据。

- `pnpm verify`
- `git diff --check`
- 页面只能经过 modules 和 platform 调用服务端。
- 活跃 MIP 代码不得读写 `member_*`、`dating_*`、`sewing_*`。
- 迁移只新增 `mip_*` 对象并写 `mip_schema_migrations`。
- 部署清单只有 `mip-*`，存储路径只有 `mip/`。
- 金额、会员、报名、签到、成长和权限判断均有服务端测试。

以下事项即使本地测试通过，仍保留 `external-wait`：支付商户和回调、正式协议正文、正式标签/城市和 AME 配置、通知模板、AI provider、活动介绍图片与任务模板的真机选择/上传/内容安全/临时 URL/相册保存、正式勋章目录图片、正式游戏化规则与队伍大本营视觉、手机号授权/换绑、扫码签到、地图/日历和真实支付。当前在线证据只覆盖 staging；生产必须在独立迁移、部署和读回后才能更新状态。

## 微信开发者工具

默认输出 `.tmp/runtime/report.json` 会被每次重跑覆盖，不作为固定证据。最近一次完整 UI 基线仍是 `.tmp/runtime-evidence/2026-08-28-final-r6/report.json`：微信开发者工具 375×724 视口下 110/110 路由、6/6 代表状态和 6/6 交互旅程通过，运行时诊断与 IDE 编译失败均为 0。2026-08-31 重跑时，公开页、活动、机会、任务、徽章和资料编辑等代表页面能够加载，WXSS 编译错误已清零；但当前开发者工具登录的是未绑定手机号的新嘉宾身份，管理页及依赖 Owner 的交互停在“请先绑定手机号”，因此本次不能替代历史完整基线。该尺寸是开发者工具视口，不是真机证据。历史与定向报告继续用于页面差异追溯：真实账号的补充证据见 `.tmp/runtime-evidence/2026-08-27-member-showcase-r2/report.json`，订单媒体与金额断言见 `.tmp/runtime-evidence/2026-08-28-order-media-r1/report.json`，任务与徽章见 `.tmp/runtime-evidence/2026-08-28-task-badge-r1/report.json`，个人资料、名片、名片设置、徽章目录和徽章详情见 `.tmp/runtime-evidence/2026-08-28-profile-badge-card-r2/report.json`；对应左右对照入口为 `.tmp/figma-implementation-comparison/focused-profile-badge-review.html`。

staging 中存在唯一、非 Demo 的 `PLATFORM_OWNER` 档案；手机号原值不写入仓库。`.tmp/bootstrap-owner-result.json` 的历史读回记录为 `ownerCount=1`、`role=PLATFORM_OWNER`、`scope=PLATFORM`。该 Owner 具有有效 TEST 玩家权益、3 场未来活动报名、1 笔 399 元 TEST 活动订单、1 笔 6000 元年度会员订单、2 个定向任务和 3 枚已佩戴勋章；它与 2026-08-31 当前开发者工具中的未绑定嘉宾会话不是同一可验证身份。管理端 1024px 代表页证据见 [响应式密度验收](evidence/admin-density-2026-08-26/README.md)；该证据不代替 Mac/Windows 微信客户端验收。

MIP staging 环境已经写入并复核 `2026-08-31-demo.20`：一年 6000 元、365 天的 TEST 会员方案，4 场 2030 年周四 MIP 早会、1 场历史活动、1 场 399 元 TEST 付费活动、3 个 NPC 任务、6 位带姓名/性别/职业身份的完整演示用户和带可替换图片的徽章目录。5 场活动及 3 条机会均通过数据库媒体记录引用演示图片。`pnpm owner:showcase` 已验证当前 Owner 具备 3 场未来活动报名、活动订单、2 个定向任务、3 枚已佩戴徽章，以及可替换的姓名、性别、职业身份、公司/职位、组织/职位和加密联系方式，重复执行结果为 `wrote: 0`；staging TEST 会员也已通过受保护 ledger 幂等确认为 ACTIVE。全部夹具使用固定 ID、版本化清单、当前 AppID 范围和 TEST 商品快照，不修改非 MIP 表，也不伪造生产支付；18 个媒体对象中 11 个新上传、7 个在 owner、purpose、对象键、文件 ID、摘要、格式、字节、尺寸与状态完全一致时安全复用。

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
- 我的档案四项影响力必须分别来自服务端嘉宾、活动心动、当前兴趣和去重访客事实；点击进入对应列表。公开档案关闭“影响力数据”后不得返回或展示聚合值，也不能从他人档案进入身份列表。
- 管理端列表和会员订单中的 `cloud://` 图片先解析为临时可显示 URL，解析失败时保留页面错误恢复，不把文件 ID 留在页面数据中。
- 指定成员任务只能从当前 AppID 有效成员中搜索和批量派发；成长等级限制为空时全部等级可完成，非空时列表、详情和完成提交均按服务端当前经验重新判级；撤销不删除历史，截止后显示“已截止”且不能完成，模板上传和保存需真机验收。
- 我的徽章展示当前启用的完整目录，已获得项使用彩色素材，未获得项使用灰度锁定状态；本人最多可保存 3 枚有效获授徽章为佩戴状态，公开档案只显示佩戴中且目录仍启用的徽章。运营端停用仍被佩戴的徽章或撤销仍在佩戴的获授记录时显示明确规则。
- 团队 PK、赛季、排行榜和队伍大本营只向当前有效会员开放；客户端携带 score/points 时请求被拒绝，管理端结算和排行只读取服务端成长事实。
- 每周赛况、历史规则、团队半年/年度独立周期榜、个人赛季/累计榜、城市筛选、当前成员和历史成员均可触达；草稿赛季快照只允许管理端预览。中性大本营状态在正式阈值与视觉替换后重新做同尺寸运行验收。
- 知识内容覆盖行业分类、内容类型/访问类型筛选、搜索、加载更多、免费/会员/单内容付费详情、评论关闭/待审/删除/举报、业务域名网页和私密视频号。管理端覆盖来源、分类、内容、商品、发布审核、评论/举报和显式采集；采集失败须保留可审计运行且不得自动发布。

## 独立 Web 管理端

- 当前 `admin-web/` React 版已于 2026-08-28 从提交 `c21b3b4` 发布到 `https://mipmini.01mvp.com/`，Cloudflare Pages 生产部署为 `22429e0f-344a-49af-8fb8-e76a75f86507`。
- 历史版本中，真实管理员在微信开发者工具确认网页登录后，浏览器进入 `AUTHENTICATED`；会话、概览、用户、活动、订单、角色、分会、消息和知识查询全部返回成功。
- 当前 Web BFF 开放 80 条经过生成契约复核的查询 action 与 80 条受审写 action；React 版的 14 个一级页面及用户、活动、订单、任务、任务完成记录、消息、知识库、机会 8 类详情已接入真实查询、筛选和适用的游标分页。写操作由精确字段白名单、一次性 nonce、capability 与作用域共同约束；Task、Banner、Game 和导出创建等关键命令具有领域持久幂等，其余操作不自动重试。Banner、游戏、8 类用途媒体上传和用户/订单敏感导出已经实现。当前版本已通过本地契约、390×844、1280×720、1440×900 响应式与 WorkBuddy 对照验证，并完成公开入口 200、静态资源指纹和未登录 BFF `401 AUTH_REQUIRED` 验证。生产环境已通过 14/14 路由的登录态读取、Banner 上传后保存为 `INACTIVE` 与软删除，以及不含手机号的零行导出文件完整性和消费验证；含真实敏感行的导出仍需受控验收。
- 无身份、短码或密钥的线上读回记录见 [evidence/admin-web-live-2026-08-28](evidence/admin-web-live-2026-08-28/README.md)。
- 未接入真实 API 的页面壳层、静态演示状态和本地数据不能作为真实业务验收证据；真实请求失败时不得回退为演示数字。

## 共享 CloudBase

### 当前事实

| 验收项 | 当前证据 | 状态 |
| --- | --- | --- |
| 56 个锁定的 `mip_*` 迁移 | 全部迁移已成功应用，版本、对象清单、隔离和幂等复跑已核对；既有稳定备份保存在仓库外，当前连续开发不再重复创建备份 | 云端已验证 |
| runtime 表级授权 | 122 张 MIP runtime 表的精确表→权限映射已收敛；Web 防重放表只授予过期清理与写入所需的精确权限 | 云端已验证；没有 schema/global 或非 MIP 表权限 |
| 仓库 057–058 迁移 | AI 请求幂等与会员邀请码分配结构已纳入 lock 和本地测试 | `external-wait`；尚未备份、迁移、收敛 124 张表权限或部署相关函数 |
| 数据库隔离 | 迁移后检查通过，只写入 `mip_*` 与 `mip_schema_migrations` | 云端已验证 |
| 开发者工具登录 | 已登录并可看到云函数列表 | 只证明可见性 |
| `mip-identity-api` | 当前工作区代码、VPC/子网、环境变量和 MySQL 健康均已完成部署回读 | 云端已验证 |
| 16 个核心函数 | 已独立复核 16/16 函数清单、环境配置、健康检查、保护调用规则及高频 timer 缺失；Task、Banner、Game、Media Web bridge 已包含在当前部署中 | 最新独立 `cloud:verify` 通过 |

项目 API Key 继续用于常规 CloudBase MCP、环境和 MySQL 管理；涉及 SCF 控制面的部署显式切换到资源所有者 Device Flow。此次没有修改 `TCB_QcsRole` 或给它追加 `scf:CreateFunction`，也没有观察到独立的 VPC/子网权限错误。认证边界和复现方式见 [CloudBase MCP 鉴权研究](../research/cloudbase-mcp-auth.md)。

当前共享环境的连续开发已经以既有仓库外备份为恢复点，不为每个追加迁移重复备份。后续迁移必须：

1. 预览 SQL，确认所有新增对象以 `mip_` 开头；
2. 查询现有对象摘要，变更后复核非 `mip_*` 对象未变化；
3. 追加迁移并验证幂等、对象清单和精确 runtime 权限；
4. 只部署 `mip-*` 函数，不安装高频通知定时器。

只有迁移到全新正式环境、执行明确的破坏性数据操作，或用户再次明确要求时，才建立新的目标环境备份与校验清单；当前开发周期不要自动重复数据库备份。

当前云端证据已经包含 56 个迁移版本、122 张表的精确授权回读、MIP 对象清单、16 个核心函数配置与健康、客户端调用规则和高频 timer 缺失检查。当前 110 路由已在 375×724 开发者工具视口通过，扩展 Demo 正常态和 1024px 管理端代表页证据也已收口；真机能力、Mac/Windows 微信客户端和正式外部配置仍待对应验收。演示数据只允许写入当前 AppID 的 `mip_*` 表，不得写入共享环境中的旧项目表。

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
| 知识外部交付 | 真机私密视频号跳转、业务域名 `web-view`、无效参数和返回路径 |
| 单内容付费 | 正式商户下单、回调、查单、首次访问、退款拒绝和全额退款后权益撤销 |

## 需求追踪

每个纵向切片在提交前更新本表或对应测试说明，至少覆盖：

- 身份与分会；
- 会员、订单和支付；
- 活动、报名、邀请和签到；
- 心动与反馈；
- 机会、引荐和感兴趣；
- 合作卡、超级案例和 AI 草稿；
- 热点、知识内容、显式采集、评论和单内容付费；
- 成长体系、任务卡与勋章；
- 团队 PK、赛季、排行榜与队伍大本营；
- 站内消息和微信 adapter；
- 平台、城市和活动权限；
- 管理端查询、脱敏、导出和审计。
