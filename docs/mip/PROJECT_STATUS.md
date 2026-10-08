# MIP 当前状态

更新日期：2026-10-08（往期活动 tab 改后台配置回顾条目并跳视频号（MIW-57）；超级案例独立列表页下线、路由契约同步 58 条（MIW-54）。此前 2026-10-06：知识/游戏/盲盒 9 页用户端下线、路由契约同步 61 条（MIW-44）。此前 2026-10-05：心动计数口径收敛与 SQL 执行验证（MIW-36）：心动可见性 SQL 收敛为共享构造、tab 徽标改服务端计数、云函数 SQL 真实执行验证、详情 onShow 缓存新鲜窗口；会员方案后台改价（MIW-35）；会员/成长整轮：玩家等级会员按钮分态、经验值详情独立页与后台可配置规则文档、首笔入会人工审核流、邀请卡图片与嘉宾关系（MIW-27）；勋章后台配置补齐 + 评审修复：勋章形象直接上传、获得条件与身份/荣誉分类暴露、草稿 key 去演示前缀、勋章形象生命周期与预览修复（MIW-25）；填写信息页一句话介绍字数与区块图标对齐设计稿（MIW-26）；此前 2026-10-04：用户信息页精简、通用游客登录单按钮流程、活动详情指引链接、原生分享邀请归属、嘉宾卡统一组件化；其他环境证据保留各自采集日期）。

本文是路由数、迁移数、operation 数、部署状态和当前缺口的唯一文档入口。产品规则见 [REQUIREMENTS.md](REQUIREMENTS.md)，验证口径见 [ACCEPTANCE.md](ACCEPTANCE.md)，逐域状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。

2026-10-08（MIW-57）：活动 Tab「往期」视图数据源从「已结束活动 feed」切换为后台配置的回顾条目（`mip_videos`）。迁移 103 为 `mip_videos` 增加 `finder_user_name`/`feed_id`（带 `sph` 前缀与格式 CHECK），原 `jump_url` 外链列按追加迁移政策保留为 dormant、全链路不再读写；`mip-admin-api` 视频草稿改为「标题 + 封面素材 + 视频号 ID（必填）+ 可选动态 ID」，无视频号 ID 的历史记录不可发布（legacy 发布前重校验被拒），内容安全输入同步换为视频号目标字段，管理合同 `mip.admin.videos.save` 幂等键更新（operation 总数不变，已再生 admin-contracts）。`mip-events-api` 新增公共只读 action `mip.events.recaps`（readActions 冷启动重试范围），只投影 `PUBLISHED` 条目按 `sort_order` 排序、LEFT JOIN READY 素材取封面云文件 ID，目标非法的行跳过。小程序活动页 PAST tab 走 `mipEventsModule.listRecaps`（300 秒 TTL、并发合并、generation 守卫），复用 `mip-activity-card` recap 变体渲染（封面走卡片级 `updateComponentMedia` 渐进水合，缺失回退占位图），点击经 `wx.openChannelsActivity` 打开具体动态（无动态 ID 打开主页），低版本不支持时 toast 提示；`mip.events.list` 的 view=PAST 服务端分支保留（「即将开始」tab 的「已结束」chip 仍依赖 ENDED 日期过滤）。同日评审确认后移除活动页顶部全局「往期回顾」视频号入口卡（`openPastReview`/`videoChannelConfigured` 一并删除）：客户口径为往期 tab 本身即「在视频号查看活动内容」，逐条回顾卡是唯一视频号入口，不再保留 tab 级 shortcut。admin-web `/videos` 列表与编辑表单去掉 jumpUrl 外链，改为视频号 ID/动态 ID 字段并前置同口径正则校验。测试：admin-api videos 域、events-api 公共投影、weapp dto/gateway/module/页面源码契约、admin-web module 往返各新增聚焦用例；`pnpm verify` 与 `pnpm admin:web:verify` 全绿。2026-10-09 部署（MIP staging）：仓库外逻辑备份 154 表/3495 行后应用迁移 103（目标环境唯一 pending 项，此前积压的迁移 102 主办方列确认已在环境内）；核心 `mip-*` 函数全量重新部署并通过 `cloud:verify`（schema、最小权限、函数、健康、受保护调用规则）；admin-web 静态以 `mip-admin-console/` 前缀部署并回读 VERIFIED（53 文件一致、Cloudflare 未变更）。正式素材配置与真机视频号跳转仍待验。

2026-10-08（MIW-54）：「我的」档案页三栏（合作卡/超级案例/相关机会）长按删除确认弹窗升级为标题带对象类型、正文带卡片标识（合作卡拼 roleName · positioning，超 16 字截断，空名回退通用文案），解决同栏多卡无法分辨删除目标的问题；同轮排查确认 `packages/member/mip-cases/list`（超级案例独立列表页）自 2026-09-23 档案页 tab 对齐 role-flow 原型（bd0096a1）后已无任何导航入口，属孤儿路由，按 MIW-44 先例整页下线：删除页面 4 文件与 `openCaseList` 死代码，路由契约三处（app.json / runtime-pages.json / project.json）同步至 58 条（用户分包 48），runtime-pages 移除 M16 路由、M17 详情 `queryFixture` 改由 `pages/profile/index` 的 `cases` 提供 `id`，`mip-banners-api` 允许列表移除该路由（云函数未部署）。云函数、数据库表与存量数据全部保留。

2026-10-06（MIW-44）：知识内容、笨笨盲盒、团队 PK 三个域的用户端整体下线。删除小程序 9 条路由（知识内容/内容详情/内容网页、笨笨盲盒/盲盒详情/卡牌背包/游戏币流水、团队 PK/队伍大本营）及仅被其引用的 `src/modules/mip-game`、`src/modules/mip-knowledge` 前端模块；同步清理首页「更多内容」知识入口、设置页「团队 PK」行、内容订单「返回内容」按钮与四处订单文案、消息 GAME/KNOWLEDGE 目标路由（存量 GAME 消息保留为不可跳转条目且不再弹窗）。路由契约三处（app.json / runtime-pages.json / project.json）同步至 61 条，设备能力清单移除 knowledge-webview，`game-ranking-tabs` 交互旅程删除。`mip-game-api`、`mip-knowledge-scheduler` 云函数、管理端知识/游戏运营、数据库表与存量数据本期全部保留，数据与后端处置另行决定；`defaults.ts` 的 `gameFunctionName` 配置随云函数保留。banner 目标白名单（`mip-banners-api` validation 及其测试）同步移除团队 PK 两条路由，指向已下线页面的存量 banner 数据待运营清理。本地根工程 vitest 1530 项、完整 `pnpm verify`（server contract 697 源 + docs 仓库事实校验）与 `pnpm admin:web:verify`（27 个 React 测试文件）全部通过；未部署、未应用云端变更。

2026-10-05（评审修复）：勋章配置 diff code review 后修复五项。① 孤儿清理守卫：`mip-media-api` cleanupOrphans 增加 `mip_badges.image_asset_id` 引用守卫（此前 `BADGE_IMAGE` 随 `PURPOSE_POLICIES` 自动进入清理范围，已绑定勋章的形象会在 24 小时后被当孤儿删除，并导致勋章无法再编辑）；② 读取侧 status 谓词：`mip-growth-api` 与 `mip-opportunities-api`（公开档案/人物卡 loadPublicBadges 新增素材 join）的勋章素材 join 统一加 `asset.status = 'READY'`，非 READY 素材回退到 `image_url` 手填兜底；③ 后台预览贯通：`mip.admin.badges.list` DTO 新增 `imagePreviewUrl`（素材优先解析，`admin-media-projection` URL_KEYS 扩展后自动换临时 HTTPS），勋章表单编辑时可预览已保存形象，AssetUploader/AssetListUploader 上传后改用本地 blob 预览（此前渲染 `cloud://` 必然裂图）；④ 错误文案去 Banner 化：`mip-admin-api` 的 `IMAGE_ASSET_INVALID`/`IMAGE_NOT_OWNED` 文案改为素材中立措辞（`mip-banners-api` 自有映射保持不变）；⑤ 补清空回读测试：勋章形象从非空到清空的服务端回读（`imageAssetId: ''` 显式清空）纳入 React 测试。门禁 `pnpm verify` 与 `pnpm admin:web:verify` 全绿（React 156 项）。

2026-10-05：勋章后台配置按 MIW-25 核对结论补齐三项（P0+P1）。① 勋章形象直接上传：新增 `BADGE_IMAGE` 媒体用途，贯通 admin-web 表单（AssetUploader）→ Web BFF（`server/admin-media-upload.ts`）→ `mip-admin-api` → `mip-media-api` 四层用途白名单与 `badges.manage` capability，迁移 098 为 `mip_badges` 增加 `acquire_condition` 与 `image_asset_id`（外键挂 `mip_media_assets`，RESTRICT），按 Banner 模式只存素材外键、读取时 LEFT JOIN 并 `COALESCE` 云文件（临时 HTTPS 地址不过期落库），服务端校验素材 READY/BADGE_IMAGE 用途/PNG-JPEG/归属；② 获得条件与分类：`acquire_condition`（≤300 字，仅作为说明展示给用户）与 IDENTITY/HONOR 分类暴露到后台列表 DTO、保存校验与表单，`mip-growth-api` 勋章集与小程序勋章页/详情页带回分类与获得条件；③ 草稿 key 前缀修复：会员配置草稿 key 由纯随机 UUID 生成，去掉 `demo_` 前缀（避免真勋章被误当演示数据）。范围裁定（用户确认）：不做有效期字段——勋章只有组织发放日期（既有 `awarded_at`）；不做获得条件自动发放——勋章仍全部由管理员人工发放。本地门禁 `pnpm verify` 与 `pnpm admin:web:verify` 全绿（迁移 99 个、Web 合同 234 项、React 153 项），未部署、未应用迁移到目标环境。

2026-10-01：活动详情页的活动评论、活动相册和加入系统日历三个实现侧超集区块已按设计稿复核整体移除（含管理端相册治理、`events.album.manage` / `events.comments.manage` capability、媒体 `EVENT_ALBUM` purpose 与 outbox 评论通知策略）；路由数与管理 operation 数已同步。`mip_event_album_photos` 表与活动相册配置列按追加迁移守卫保留为 dormant 历史数据。该轮改动仅完成本地验证，未重新部署。

## 结论

- 后台产品验收唯一入口已统一为 [admin-web/ACCEPTANCE.md](../../admin-web/ACCEPTANCE.md)，替换历史交互改造全勾选清单。五份上游原件、伙伴提交历史、原始缺口见[9 月 29 日审查](evidence/admin-audit-20260929/README.md)，当前实现/验证状态见[管理端矩阵](COVERAGE_MATRIX.md#管理端)。本轮可独立推进的整改已发布至既有 CloudBase staging 目标，不能把原审查当作当前未修复清单。
- 最新完整 `pnpm verify:all` 通过：根工程 1484 项、Web 合同 233 项、React 152 项。本次常用功能修复已部署，4 个业务函数的 205 个运行时源码文件及 Web BFF 的 14 个公开静态资产回读一致，源码 `d96a34c3`；[常用功能 CUA 证据](evidence/admin-common-cua-20261001/README.md)记录真实读写及明确未验分支。兼容迁移 094/095 已应用；此前九个业务函数全部部署，下载代码与本地 JS 一致且 MySQL 健康通过。2026-09-29 概览改版和机会恢复招募增量已发布到既有 CloudBase staging：真实 HTTPS 66/66、14 个读模块、`mip-admin-api` 274 个 JS 下载比对及健康检查通过；演示对象结束/下架后编辑保存、恢复/重新招募 14 项通过且数据还原。三个实际 CSS 视口和概览交互已复核，详见[增量验收记录](evidence/admin-overview-20260929/README.md)。53 条产品场景仍未全部验收，17 条受未确认规则影响。

当前产品形态为“小程序用户端 + 五路由小程序现场工作台 + React Web 主后台”。会员、活动、机会、成长、任务、游戏、内容、消息、订单、支付和运营管理已经形成统一的服务端事实与本地实现底座，不需要整体重写。

仓库清单当前为 58 条小程序路由（用户分包 48 条）、104 个迁移（均已锁定）、240 个渠道中立管理 operation（105 查询、135 写）和 16 个数据库核心函数。Web 合同允许其中 105 个查询与 123 个受审 mutation。以上数字只描述当前代码合同，不自动证明每个 action 均有真实实现，更不证明运行时、云端或生产通过；部署与验收边界见下文。

## 后台完整整改执行 checkpoint

- 2026-10-01 常用功能专项：公开 Chrome Computer Use 验证资料保存/还原、机会完整状态切换、筛选订单非空 Excel、任务配置及模板上传保存/清空、Banner 上传编辑启停、视频回填下架、知识与案例草稿编辑、勋章配置、消息具名接收人草稿和审计关键词。修复 HTTP 审核上下文/出站、表单串值与标签、知识界面字段泄漏、案例 JSON 空字段、审计筛选、编辑返回及接收范围显示；源码 `ee175186`、`caea3723`、`92fdc484`、`d96a34c3` 已推送部署。最终任务下架 v6、机会结束 v8、Banner 停用 v4，知识 v2、案例 v3、消息 v2 保持草稿；个人资料已恢复。公网出口仅补齐任务/Banner 的微信审核请求，入站/VPC/角色/网关/DNS 不变，无新增定时器。最近完整门禁通过；[逐项证据](evidence/admin-common-cua-20261001/README.md)区分已测分支、仅读取模块和未执行的支付/权限/通知/派发审批奖励。下一步仍按唯一标准补目标环境真机、跨端和受控角色完整旅程，不将 CRUD 等同于整条通过。

- 2026-10-01 活动专项：使用 Chrome Computer Use 在真实公开 staging 后台执行创建/编辑/私有草稿/预览/发布/下架恢复/结束、复制、标签启停/绑定/快捷回填、名单搜索与非空导出、免费补录/异常/补签/撤销/取消、签到码展示下载及三种实际视口。七项缺陷已修复，源码 `c9b8047f` 已推送；两个既有函数代码包、162 个管理运行 JS 与 14 个公开静态文件回读一致，网关/权限/DNS/定时器不变。专用主活动已结束、报名已取消、目录停用，保留历史；第二活动仍是未发布收费测试草稿。完整门禁通过；[逐项运行证据](evidence/admin-events-cua-20261001/README.md)区分已通过步骤、独立场地 H5 缺口、旧样例签到事实不一致及未完成的微信扫码/支付/退款/审核候补/全角色旅程，不将 E01–E09 整条升级为通过。

- 2026-09-30 复核：修复会话乱序/退出缓存、机会商业条件清空、用户内容归属与类型约束及归档编辑、活动复制路由上下文；用户内容回填统一到中立模块。真实只读检查 70/70、14 模块/7 类详情，演示机会商业条件保存/清空/还原 6/6。源码 `fdc524f5` 已推送且 CI 36682628775 成功；新前端已进入现有 BFF，临时根路由使用其静态处理器，入口 `index-Cc5-tcUT.js`。SCF 控制接口静态哈希 14/14、部署后复验 66/66（14 读模块）通过；公开 HTTPS 此后已恢复，重新访问 HTML/JS 哈希一致，真实登录/14 读模块/退出复验 66/66 通过，Chrome 登录弹窗正常；首轮任务完成列表 503 保留，仍不是全部浏览器写入流程通过。工程门禁、首轮失败和路由恢复顺序见[复核证据](evidence/admin-review-20260930/README.md)；整条产品场景状态保持矩阵口径。

- 计划：[EXECUTION_PLAN.md](../../admin-web/EXECUTION_PLAN.md)。已制定 W00–W21 工作包，主责映射覆盖全部 53 组产品场景；可维护性 K01–K08 已进入唯一验收标准。
- 当前状态：W00 已保存原有登录与文档改动的精确基线。机会回填/筛选导出、冲突保留、活动草稿/复制/标签/名单/反馈、独立用户档案/关联分页/勋章、岗位模板和八个授权消费者、服务器负责人/排序、成长流水、退款动作投影、视频/Banner/用途上传、消息批次、知识治理分页、团队成员和负责人保护已有实现及测试。概览已接同一时间/范围查询，未决指标和团队模型等仍保留缺口。各包逐条状态仍以矩阵为准，不据工作包标题宣称全部通过。
- 最近检查：完整门禁通过，云函数测试、lint、类型、构建、契约生成与隔离检查均通过；CloudBase 真实非空活动列表/详情已验证 1280×720、1440×900、390×844；私有草稿保存/刷新恢复/放弃未保存修改、两用户独立 Tab 已复核。发布前数据库及十个函数备份已核对，094/095 与九个业务函数回读通过。前端入口 `index-BCN0QiWF.js`，12 个静态文件 SHA 核对；六类非空导出共 32 项、未发布活动图片绑定 10 项通过。岗位模板入口启用且四个验收模板停用、绑定数 0；没有真实授予、退款或群发。证据与逐项打勾入口见[执行目录](evidence/admin-execution-20260929/README.md)。
- 后续概览/机会增量：代码 `3e6292c3936de85ad51115cb044fea9563c731d6`，CI 36574337283 成功；当时 CloudBase 静态入口为 `index-7y2SrvN2.js`，前端/BFF/管理 API 已更新。四项关键指标、趋势图和分组明细已实拍；机会结束/下架后真实保存、恢复/重新招募、版本与审计回读通过，验收数据还原。没有改变 Q-ADMIN-02～09 的待确认政策，支付仍为 TEST。
- 规划验证：2026-09-29 完整 `pnpm verify:all` 通过；文档检查、53 组场景唯一主责映射、22 个工作包依赖无环检查及 diff 检查通过。Web 构建仍有既有 bundle 大小提示，未导致门禁失败；以上不替代业务运行验收。
- 业务待决统一见 REQUIREMENTS 的 Q-ADMIN-02～09；Q-ADMIN-01 已确认下架恢复和重新招募，只影响相关步骤；不重新创建第二套问题或验收表。
- 后续每次只在此更新当前工作包/小步骤、最近验证、当前局部阻塞和下一步；场景实现/验证结果仍在 COVERAGE_MATRIX。

## 2026-10-08 活动详情页两态底栏、模块删除与主办方介绍（MIW-53）

客户反馈从「我的-活动-待参与/已参与」进入活动详情与设计稿不一致。三段口径按客户逐条确认落地：

1. **底部 sticky 两态**：未报名且服务端 `canRegister` 时为客服胶囊+转发胶囊+黄色「立刻报名」；其余一切状态（已报名、待支付、审核中、候补、已签到、已结束/已取消、暂不可报名）只保留客服+转发双胶囊平分宽度，无任何黄色主按钮（与你互动入口已在参与人数模块内）。客户端状态机收敛为 `primaryAction = canRegister ? 立刻报名 : null`，报名可能性完全由服务端决定，不再自行推导 disabled 文案。
2. **整页删除「邀请来源」「活动签到」「活动变更」三个模块**（含已报名态；活动变更为同日追认口径）。扫码签到链路（J0-01/J0-02）不受影响：扫码直达详情页仍自动签到，自动签到失败提示改为「重新扫描现场活动码进入本页重试」；check-in 页面仍从报名完成页、支付结果页、订单详情页可达。服务端/管理端的变更记录能力不动，仅会员端详情页不再展示。
3. **「主办方」Tab 改为主办方介绍**（小程序需求 C1/TC-C-01：活动详情展示活动介绍、主办方介绍、报名须知；后台 PRD 图文内容口径）：新增迁移 102 `mip_events.organizer_introduction`（TEXT NULL，与活动介绍同上限 2 万字、同内容安全审核通道），`mip-admin-api` 草稿校验/保存/复制（含复制草稿）与 `getEvent` 回读贯通，`mip-events-api` 详情投影未配置时不下发；admin-web 活动表单新增「主办方介绍」多行文本（含移动端预览卡与表单回填）。小程序「主办方」Tab 用与活动介绍同一 `eventRichTextNodes` 通道原样渲染（富文本含内联图片即满足图文），未配置回退「暂无主办方介绍」；旧的主办方资料卡（头像/昵称/一句话介绍/跳转公开档案）从本页移除，DTO `organizer` 字段保留仅作合同稳定。范围裁定：TEXT 富文本通道（不引入第二个媒体 asset-list），与「活动介绍」能力对齐。

验证：`mip-admin-api` node:test 743 项、`mip-events-api` 159 项、根工程 vitest 1543 项、Web 合同 238 项全部通过；本机开发者工具整页截图两态底栏与 figma 1818_17142/3319_5944 一致（[证据](evidence/activity-detail-sticky-20261008/README.md)）。`mip-admin-api`、`mip-events-api`、admin-web 均需重新部署；迁移 102 需在目标环境应用后主办方介绍才可配置。

## 2026-10-07 两个机会「死页」与编辑器「更多设置」删除（MIW-42）

客户拍板：`packages/member/mip-opportunities/mine`（我的机会）与 `packages/member/mip-cooperation/list`（合作卡列表）两个无导航入口的页面删除；发布机会编辑器的「更多设置」折叠区（金额范围/合作地点/发布范围/行业/能力/团队成员）不是客户需求，一并删除。路由契约三处（app.json / runtime-pages.json / project.json）同步至 67 条（用户分包 59→57）。

安全删法——数据与提交组装保留，仅删 UI 与交互：编辑器不再渲染「更多设置」表单块与团队成员选择器，但 `industryTagIds/abilityTagIds/minAmountYuan/maxAmountYuan/locationTypes/locationCityTagIds/scopeType/branchId/teamMembers` 仍参与详情回填与 save() 载荷组装，编辑存量机会时这些字段原值原样带回，不会误清；新发布的机会这些字段传空（服务端 `normalizeDraft` 本就全部可选），字段改由管理后台 `admin-web` 机会编辑表单维护。合作卡列表页删除后其职责由既有页面承接：本人合作卡管理在「我的」档案页相关合作卡栏（长按删除，`deletePortfolioItem` 三栏统一口径，J6-01~03）；浏览入口在机会页人才合作 Tab；M14/M22/M55 三条 `queryFixture` 改挂 `pages/opportunities/index`（reLaunch 携 `mode=cooperation`，页面 `onLoad` 解析后落人才合作 Tab 取 `cooperationTalents`）。MIW-40 订阅引导的 mine 页挂载点删除，详情页是唯一 pending 消费方（S8 落地页）。`listPeople` 全链下线（客户端模块/transport/云函数 domain+入口/demo 脚本），`mip-opportunities-api` 需重新部署。

## 2026-10-07 我的机会链路客户复核五项（MIW-50）

客户复核「我的机会」链路提出五项：①详情底部条「编辑」文字竖排；②编辑表单无「合作角色」需删除；③底部「取消」设计稿没有需删除；④未改动任何内容点保存报「提交内容格式不正确，请检查后重试」；⑤编辑页按返回出现第二个「发布机会」页、两次才回详情，且保存后也应落回详情。

①组件级修复：`mip-pill-button` 在 176rpx 窄胶囊（详情页「编辑」/「编辑草稿」，`withIcon`）里图标+间距占位后文字可用宽度不足，label 可换行导致逐字竖排；修复为图标与 label 整体 `flex-shrink: 0` + `white-space: nowrap`（内容居中溢出左右 padding），所有窄胶囊用法（案例详情分享等）一并免疫。②延续 MIW-42「更多设置」口径：编辑器删除「合作角色」表单项（`roleOptions` 仅作存量回填、save() 原样带回，角色维护收敛到管理后台），客户端 `normalizeOpportunityDraft` 与服务端 `normalizeDraft` 同步放开空 `roleKeys`（非法 key 仍拒），新增机会允许无角色。③删除编辑器底部 `always` 取消按钮；loading/error 态保留非 `always` 的 `<app-page-exit label="取消">` 作为栈根兜底（分享/直达进入时仍可退出）。④服务端保存改为「变更门禁」引用校验：`saveOpportunity` 先取存量行（SELECT 增加 `cover_asset_id/city_tag_id`），`assertReferences` 仅校验相对存量发生变化的分会/封面/主营城市/行业/能力/商业条款城市引用，`resolveTeamUserIds` 在名单与存量 ACTIVE 成员一致时跳过资格复核——目录漂移（标签停用、分会停用、素材清理、成员失格）不再卡死「什么都没改」的编辑保存，真正改动的值仍走完整校验；新增 `cloudfunctions/mip-opportunities-api/tests/change-gated-validation.test.js` 7 项覆盖。⑤保存成功导航：编辑存量机会（`data.id === result.id`）在页面栈中查找本机会详情页并按 delta `navigateBack`（顺带清理栈中夹层的旧编辑页），找不到时 `redirectTo` 详情兜底；新建流程维持 journey-review J4-04 口径（确认发布回上级页面，无上级时落详情）。⑤中「不保存按返回出现第二个『发布机会』页」在静态代码中未找到制造者（所有编辑入口均为单次 `navigateTo`，编辑器无自跳转），疑似旧构建或历史页面栈残留，待真机复测确认。

验证：完整 `pnpm verify` 全绿（根工程 vitest 1516 项、`mip-opportunities-api` node:test 139 项含新增 7 项），DevTools 模拟器强制渲染 owner bar 截图确认「编辑」横排。`mip-opportunities-api` 服务端合同变更（角色放开 + 变更门禁），需重新部署后生效。

**追加（同日第二轮客户反馈）**：⑥编辑器删除「保存草稿」按钮——表单只以「确认发布/保存修改」（`publish=true`）收口，草稿态编辑同样以发布收口（新建先落草稿再发布是服务端既有机制，不受影响）；wxml 按钮、`saveDraft` 处理器与「草稿已保存」toast 兜底一并移除，随删 `t-button`/`t-icon` 两个失效组件注册，figma-surfaces 三处 pin 改为负断言。⑦三端字段上限对齐——审计发现会员端（targetSummary 500 / description 6000）与管理端（300 / 5000）不一致，历史长文在管理后台编辑保存会被 `VALIDATION_FAILED` 拒绝：`mip-admin-api` `normalizeOpportunityDraft` 与 admin-web BFF+UI（`content-mutation-forms`）四处统一取 500/6000。客户实测仍报「提交内容格式不正确」的原因即服务端旧合同未部署——本轮 `mip-opportunities-api`（角色放开+变更门禁）与 `mip-admin-api`（上限对齐）均需重新部署，admin-web 需随发。

## 2026-10-06 人才名录收敛为人才合作 Tab（MIW-42）

客户确认「人才合作」Tab 就是人才名录/目录本体，且属玩家（会员）权益；独立全局人脉目录页 `packages/member/mip-people/index` 与机会列表底部「找不到想要的？打开更多入口」入口（无会员门槛，构成权益绕行）一并删除。路由契约三处（app.json / runtime-pages.json / project.json）同步至 69 条（用户分包 60→59）；`runtime-pages.json` 移除 M29 路由与 people 交互场景，M22/M55 `queryFixture` 改由 `mip-cooperation/list` 的 `talents` 提供 `profileRef`（合作卡详情 M14 的 fixture 链早已依赖同一来源）。`mip-opportunities` 模块的 `listPeople` 未整体下线：发布机会编辑器的团队成员选择器（最多 8 名有效玩家）仍依赖它，因此保留为仅玩家口径——服务端 `discovery.listPeople` 强制拼接 ACTIVE `mip_membership_entitlements`，原先的 GLOBAL（无门槛游客目录）范围删除，关闭绕行；客户端 `PeopleFilter` 收敛为 `keyword/limit`，`PeopleKindFilter/PeopleSearchScope` 与 cursor 分页移除。`mip-banners-api` 允许列表移除该路由。`mip-opportunities/mine` 与 `mip-cooperation/list` 两个页面本轮保留未删（后经 2026-10-07 客户确认已删除，见上条）。云函数 `mip-opportunities-api` 需重新部署后 PLAYER-only 口径才在生产生效。

## 2026-10-05 会员方案后台改价（MIW-35）

客户提出 6000 元/年的会员价格需要后台可配置。此前价格虽由服务端下发（`mip_membership_plans.price_cents`，下单时快照 `amount_cents` + `product_snapshot_json`），但全仓库对该表只有 SELECT，改价只能直改数据库，无审计、无并发保护。本轮补齐「只改价」闭环，管理合同增至 240 operation（105 查询、135 写；Web 开放 105 查询、123 受审 mutation），admin-contracts 已再生：

- 契约：`mip.admin.membershipPlans.list`（QUERY，返回该 app 全部方案含 TEST/LIVE 两 stage 与 status/version）与 `mip.admin.membershipPlans.save`（受审 mutation，入参 `planId`/`expectedVersion`/`priceCents`，幂等键由 Web BFF 转发）。
- 服务端：`mip-admin-api` 新增 `domain/membership-plans.js` + `domain/repositories/membership-plans.js`（照 `membership-content` 成对结构），挂 MEMBERSHIPS manifest。保存走事务：`lockMutation` → `claimOptional` 幂等 → `SELECT ... FOR UPDATE` 校验 `expectedVersion`（冲突抛 CONFLICT「请刷新后重试」）→ 带版本守卫的 `UPDATE price_cents, version+1` → 审计 `MEMBERSHIP_PLAN`（metadata 记新价 `priceCents` 与旧价 `previousPriceCents`）。价格校验 1..100000000 分（¥0.01–¥100 万）；方案不存在抛 NOT_FOUND。读复用 `growth.read`、写复用 `growth.configure`（与会员协议保存同一权限，未新增能力、未动角色种子）。`RUNTIME_TABLE_PRIVILEGES` 中 `mip_membership_plans` 由 `['SELECT']` 扩为 `['SELECT', 'UPDATE']`（部署时需跑 `scripts/converge-mip-runtime-grants.mjs` 对账真实 GRANT，此前该表运行时账号只读）。
- 后台：React「成长」页新增「会员方案」页签，行内只读展示名称、TEST/正式 Tag、时长、状态，价格以元为单位用 InputNumber 编辑（元→分 ×100 取整校验），保存带该行 `version`，成功提示「已保存，仅新订单按新价格下单」。
- 约束：名称/时长/状态只读，不做新建/删除/上下架（当前仅一条年卡方案，等客户提出再扩展）；小程序端零改动。改价只影响之后的新订单（已支付订单金额与快照不可变），TEST 与 LIVE stage 相互独立，均为既有机制保证、本轮未新增代码。
- 验证：完整 `pnpm verify` 与 `pnpm admin:web:verify` 通过（新增 `tests/membership-plans.test.js` 7 项：权限、服务端绑定、校验、版本冲突、幂等重放、审计新旧价、list 投影；admin-web 面板 React 测试补会员方案渲染、元→分换算、只读形态与冲突提示）。当前为 verified-local，未部署、未做后台改价→小程序下单页的真实链路验收；并发编辑两人冲突、审计留痕留待 browser 验收。

## 2026-10-05 AI 助手录音语音填写（MIW-34）

超级案例与合作卡编辑器的 AI 助手入口接入完整录音→转写→结构化链路（设计稿 2172:42168 录音主操作、2173:42605 AI 助手卡）。语音转写选型腾讯云 Flash ASR（录音文件识别极速版，`asr.cloud.tencent.com/asr/flash/v1`），实测 15 分钟/5.4MB mp3 约 5.3s 出稿；文本结构化沿用 CloudBase AI 网关（DeepSeek）。实现分两层：`mip-ai-draft-provider` 新增 `flash-asr.js` 签名客户端与 `transcribeAndStructure`（voice 预算 45s：下载 2s + ASR 20s + LLM 30s < 云函数 60s 平台上限，voice 调用不重试）；`mip-ai-api` 新增客户端直传云存储通道 `prepareVoiceUpload` → `wx.cloud.uploadFile` → `createVoiceDraftStorage`，对象路径由服务端 HMAC scope 生成（客户端不可伪造路径），提交时服务端复验路径归属、字节数（≤6MB）与 sha256 摘要，幂等新增 `VOICE_STORAGE` 类型并把直传中音频纳入清理保护。前端新增 `packages/member/mip-ai/voice/index` 录音页（开始/录音中计时与波形/确认（含回听）/删除提示四态，系统打断后回到前台自动把已录内容接回确认态）与 `voice-recorder`（RecorderManager 全局单例、帧流累积拼接、平台 10 分钟分段自动续录到 15 分钟上限、16kHz/mono/48kbps 使 15 分钟约 5.4MB），编辑器入口带 `purpose` 跳转、完成后带 `aiDraftId` 回跳填表。

验证口径：mip-ai-api 86/86、mip-ai-draft-provider 43/43、根工程 `pnpm verify` 全门禁通过；真实录音 A/B 探针（ASR 时延、CloudBase 结构化、云存储直传）已在开发环境跑通。**尚未验收**：ASR 密钥仅存在于本地不入库探针文件，未配置到云函数环境变量（`TENCENT_ASR_SECRET_ID/KEY/APPID`），`mip-ai-api`/`mip-ai-draft-provider` 需按 60s 超时重新部署后能力门控才开放；录音权限、帧回调与分段续录仅真机可验；运行时路由扫描中该页因能力门控未开放而停在 error 态，不构成运行时通过。

## 2026-10-05 填写信息页字数与图标对齐

MIW-26：填写信息页（`packages/member/mip-profile`）「一句话介绍你的工作和背景」交付还原分支硬编码 `0/300`，改为真实计数 `{{(figma.intro || '').length}}/160`（160 为服务端契约 `boundedText(headline, 0, 160)`；生产表单此前已是 160，未改）。该区图标按设计稿字形对齐：`draft-line` / `survey-line` 补入 mip-icon 注册表，页面四个区块标题统一为设计稿字形（基础信息 `contacts-1-1`、代表行业与当前身份状态 `draft-line`、一句话介绍 `survey-line`），同时消掉本页 3 个 `t-icon` 外来图标与 4 张裁坏的还原贴图。前后对比见[填写信息字数与图标证据](evidence/20261005-miw26-profile-intro/README.md)。完整 `pnpm verify` 通过（根工程 1504 项测试）；Layer 3 像素 97.27% → 97.29%。参考稿 `figma-restored`（ame-project 仓库）此细节仍是 0/300，未改设计证据仓库。

## 2026-10-05 活动详情「与你互动」卡片（MIW-28）

活动详情参与人数模块的已签到态新增「与你互动」区块（黄色标题 + 「我的心动 N / 对我心动 N」两枚胶囊，深链参与人页对应心动 tab）。口径经客户确认（2026-10-05）：已签到即展示，0/0 也显示，废止 journey-review J0-01 的空态隐藏规则（设计师批注 2133:3831 不再适用）；未签到整卡隐藏。服务端仅对 `registration_status = 'ATTENDED'` 的查看者下发 `interactionSummary`，计数与参与人页心动 tab 同人群（received 侧含投票者资料 JOIN、拉黑双向过滤）；计数属装饰性数据，查询失败只隐藏卡片、不阻断详情主载荷，并随详情其余独立子查询并行执行。客户端可见性只跟随服务端 `canInteract` 与 `interactionSummary`，不再重复推导签到状态。

代码评审曾发现该计数 SQL 把拉黑片段（裸 `NOT EXISTS`）拼进 JOIN ON 缺少 `AND` 前缀，会使已签到用户的 `mip.events.detail` 整体 1064 失败；已改为片段置于 WHERE 并补 `AND`，拆为两条独立计数查询，测试新增 `AND NOT EXISTS` 连词回归守卫与计数失败降级用例。完整 `pnpm verify` 通过。真机上的签到后卡片展示与心动深链仍待验收。

## 2026-10-05 心动计数口径收敛与 SQL 执行验证（MIW-36）

MIW-28 的三项质量跟进，产品口径不变（已签到 0/0 照常展示、胶囊深链参与人页心动 tab 不变，本卡无真机验收项）。

① 心动可见性 SQL 收敛为共享构造：`mip-events-api` 新增 `heartVisibilityFilters(userId)`——sent/received 两个方向的谓词、对方报名 JOIN、资料 JOIN 与拉黑双向过滤的唯一来源——与 `heartCounts(db, {appId, eventId, userId})`（两条 COUNT，详情胶囊与 `getHeart.counts` 的唯一计数来源）。`getHeart`、`listHeartCandidates` 与 `getEventInteractionSummary` 全部改为消费该构造：此前 5 条手写 SQL 各自表达「心动可见」且已漂移（selected 查询缺拉黑过滤、getHeart target 与 received 各写各的），现收敛为零；selected 查询的拉黑过滤缺口一并补上。getHeart 的 target 行读取保持不含 status 谓词（CANCELLED 行仅为并发版本号而读，`mip_event_hearts_status_ck` 保证其 `target_user_id` 恒 NULL），注释已钉进 `heartVisibilityFilters`。参与人页心动 tab 徽标改消费服务端计数（`heartMineCount`/`heartReceivedCount`，与详情胶囊同一 `heartCounts`），不再以 `sentItems.length`/`receivedItems.length` 重算（REQUIREMENTS「以服务端口径统计」）；心动页每次 `getHeart`/`setHeart` 后经新增的 `patchEventInteractionSummary` 回填详情缓存。

② 云函数 SQL 真实执行验证：新增 `cloudfunctions/mip-events-api/tests/sql-execution.test.js` 两层防线，覆盖 `getEvent`/`getHeart`/`listHeartCandidates`/`heartCounts` 产出的全部语句。结构层恒跑：录制四类函数发出的 14 个语句族（含 `mip_app_settings` 取消截止回退与窗口函数标签查询），逐条 node-sql-parser MySQL 方言解析 + mysql2 占位符语义计数与 params 一致性 + sent/received 片段同源断言——MIW-28 的 1064 类故障（片段拼进 JOIN ON 缺 `AND`）在解析处被拦截。执行层由 `MIP_SQL_VERIFY_AUTO=1`（mysql-memory-server 自备一次性 MySQL 8.4，二进制按版本缓存）或 `MIP_SQL_VERIFY_URI`（任意 8.0.16+ 实例，仓库迁移用 `DROP CHECK` 语法）门控：应用全量 102 个迁移、种子真实场景（已签到查看者、已离开但报名行仍在的投票者、拉黑双向过滤、无任何心动的已签到者），端到端断言详情计数 == `getHeart.counts` == `heartCounts` == 列表长度、已签到 0/0 照常下发、未签到不下发 `interactionSummary`、拉黑者双向不可见；本机实跑通过。`pnpm verify` 默认只跑结构层（确定性优先）。devDependencies 新增 `node-sql-parser@5.4.0` 与 `mysql-memory-server`。

③ 详情页 onShow 强刷消除：`mip-events` 模块 `getEvent` 新增 `maxAgeMs` 新鲜窗口与 `patchEventInteractionSummary` 回填，`invalidateEventCache` 统一报名/改单/取消/签到（`checkIn` 此前漏失效，一并补上）的缓存失效。`detail/index.ts` onShow 由每次 `loadEvent({ force: true })` 重发全部详情子查询改为 `maxAgeMs: 30_000` 的 cache-and-revalidate——详情 ↔ 参与人一次往返通常在数秒内，窗口内直接应用缓存（心动计数已被回填，返回即见最新值），超窗后台重验证；缓存缺失（报名/取消/签到后）时照常真实拉取，报名态与签到态变化的即时感知不变。重试、场景恢复、自动签到、CONFLICT 等其他入口仍显式强刷。

测试：模块层新增新鲜窗口命中/超窗重拉/状态变更失效/计数回填用例（`tests/mip-events-module.test.ts`），页面契约新增 onShow 窗口与徽标消费服务端计数的断言（`tests/mip-event-experience.test.ts`、`tests/mip-event-video-recaps-page.test.ts`、`tests/mip-event-participants-visual.test.ts` 同步改钉新契约）。完整 `pnpm verify` 通过（根工程 1529 项测试）；执行层验证以 `MIP_SQL_VERIFY_AUTO=1` 实跑通过（MySQL 8.4.9，102 迁移 + 种子 + 四函数端到端断言）。

## 2026-10-04 通用游客登录引导提取

活动详情、机会列表和我的页此前各自内联同一套游客登录引导（未登录/未绑手机号 → 弹层手机号授权；已绑手机号的退出账号 → 显式「重新登录」恢复；新账号 → 补资料后回原页；协议等剩余项 → access 页；就绪 → 原页就地继续），已提取为共享控制器 `src/modules/mip-identity/guest-login-flow.ts`（MIW-20）。页面只注入路由、token 槽位、弹层状态与原意图的就地执行，不再各自复制恢复分支。已绑手机号的账号再次登录不重复授权手机号——授权 code 一次性、服务端换绑后 `phoneBound` 随快照持久，由服务端决定 PHONE 项是否已满足。

同日产品调整（仍属 MIW-20）：`mip-login-sheet` 双按钮合并为单主按钮。退出过的老账号（本地有退出记录）点主按钮先按 OpenID 恢复会话，已绑手机号直接完成登录、不再弹原生授权；服务端确认未绑时主按钮原位切回「微信手机号授权」形态再弹原生授权（原生授权窗只能由真实点击调起，无法并入同一次点击）；新游客直接进手机号授权形态。授权后仍按协议 → access 页、新用户 → 补资料、就绪 → 原页就地继续。数据键 `loginSheetAllowSignIn` 更名 `loginSheetRestoreFirst`，组件属性 `allowSignIn` 更名 `restoreFirst`。journey-review J0/J1 口径由 `tests/mip-guest-login-flow.test.ts`（19 项）与既有页面测试共同钉住。完整 `pnpm verify:all` 通过（根工程 1504 项测试）。手机号授权与换绑仍需真机验收，A1–A4 维持矩阵口径不变。

## 2026-10-05 玩家等级会员按钮与经验值详情页（MIW-27）

玩家等级页（客户口中的「会员」页）底部按钮按会员事实分态：未加入（游客）保持「立即加入」；已加入玩家未进续费窗口时「邀请加入」改为黄底 primary 全宽（此前恒为黑底 secondary，属修正）；进入到期前 3 个月窗口后「立即续费」黄底居右、「邀请加入」退居左侧黑底黄字。右上角「经验值详情」入口下移至与 EXP 进度条同一水平线并放大一档；点击不再滚动到底部原地展开，改为跳转新增的 `packages/member/mip-experience-details/index` 经验值详情页（figma 1948:14177），「规则详情/经验值明细」双页签，明细按 EXPERIENCE 指标由服务端过滤（`mip-growth-api` listEntries 新增 metric 参数，非法值回退全量，保住 keyset 分页游标）。路由契约三处（app.json / runtime-pages.json / project.json）同步至 69 条。判断口径：明细卡副行取流水时间（规则表无描述列，设计稿副行文案无数据来源）；规则详情页签按占位设计帧沿用明细卡骨架；等级与权益、成长数据原展开区块随展开交互一并移除（无设计帧承载）。完整 `pnpm verify` 通过。

同日追加第二轮：「立即加入」首笔付费不再即时生效——ledger 为首笔付费会员在 `mip_membership_approvals`（迁移 101，每用户至多一条）自动落待审核记录，会员资格投影为 PENDING；已拥有过会员（ACTIVE/EXPIRED/REFUNDED）或运营开通资格的玩家按续费处理，不设审核。管理后台「成长」页新增「入会审核」分区，行内受控弹窗同意/驳回（驳回必填审核意见，会员链版本乐观锁，留审计并写 outbox `membership.approval_decided`，outbox 按 OPERATION_RECEIPT_SUPPRESSED 消化不生成站内消息）；同意后资格立即生效（到期自支付起算，审核时长不补偿，特殊补偿走运营开通），驳回置 REVOKED，复议通过同链恢复。小程序端按服务端快照如实展示：支付结果页提示「管理后台审核通过后生效」，玩家等级页/会员方案页展示「审核中」并暂停重复下单，权益页展示待审核形态；身份投影保持嘉宾不变。「邀请加入」卡片暂用品牌默认封面并记录嘉宾邀请关系。管理合同增至 238 operation（104 查询、134 写；Web 开放 104 查询、122 受审 mutation），admin-contracts 已再生。

同日评审修正（第三轮，取代第二轮的逐条规则文案方案）：「经验值详情-规则详情」不是逐条规则卡，而是一整段由管理后台配置的文本（与经验值明细的逐条流水卡不同）。改走既有 membership-content 文档通道：`mip_app_settings` 新增 `EXPERIENCE_RULES_TEXT` 键，作为第三种文档 `experience-rules`（复用两份协议的版本乐观锁、幂等键、审计与演示标记，无需新迁移，管理合同 operation 数不变——文档枚举不属公开契约固定项）。管理后台「成长」页新增「经验值规则说明」页签（标题/正文/演示标记），成长奖励规则编辑弹窗移除「规则说明」字段、只维护奖励数值并以提示指向该页签；第二轮迁移 098 的 `mip_growth_rules.description` 列按追加迁移政策保留但全链路不再读取（admin 校验/投影、growth-api DTO 与 SELECT、小程序 `GrowthRule` 类型同步移除）。小程序「规则详情」页签读取该文档整段正文按 `whitespace-pre-wrap` 纯文本展示（保留换行），未配置时展示空态说明；页面不再依赖 getSnapshot。

## 2026-10-05 活动日历筛选器黄点与默认态收口（MIW-39）

活动页「活动报名」筛选行右上角默认只保留日历入口，移除常态常显的「今天」文字与 TODAY 快捷筛选（figma 1819_17793 产品口径：未选日期不显示任何日期文字）。只有用户在日期选择器选中日期并确认后才出现筛选标签——选中当天显示「今天」，其他日期显示「M月D日」（沿用 MIW-37 的 confirmCalendar），点标签或日历 icon 都会再次打开选择器。日期弹层补齐黄点语义：当天有活动的日期在数字下显示品牌黄点（#fcdf03、12rpx），无活动不显示。

黄点数据走新增公开只读契约 `mip.events.calendarDates`：按 `dateFrom/dateTo(+cityName)` 返回范围内「当天仍会被公开目录列出」的中国业务日期（PUBLISHED + published_at 非空 + ends_at 未过，按 `DATE_ADD(starts_at, 8h)` 归日、去重升序，范围上限 62 天）。谓词与 `listEvents` 的 UPCOMING/CUSTOM 同源，保证「有点子 ⟺ 选中该日列表非空」。客户端 `mipEventsModule.getCalendarDates` 归一化日期范围，按「范围+城市」缓存 5 分钟并合并并发、随 invalidate 清空；旧部署网关未实现该 action 时整体降级为无点。events 页打开弹层或翻月时按可见月份取数，失败仅降级为无点不阻断选日期；翻月或关闭后的迟到响应按可见月份守卫丢弃。

`config/ui-fidelity-screens.json` 三个「活动-首页」像素夹具从 TODAY 默认态改为「已确认当天」的 CUSTOM 态，与还原稿右上角「今天+日历」pill 对齐（还原稿 1819_17664 本身仍画着默认态带「今天」，按产品口径不再跟随）。MIW-11 的「tab 不提供区间筛选」断言收窄到 `currentQuery` 查询构造——`dateFrom/dateTo` 现为日历取数所复用。完整 `pnpm verify` 通过（根工程 1531 项测试、260 个测试文件）；`mip-events-api` 未重新部署，新 action 属追加，未部署期间客户端自动降级为无点。

## 2026-09-29 后台登录与临时入口

密码登录已发布有限等待与临时失败重试，完整门禁通过。临时入口 https://mipadmin.01mvp.com 以 Cloudflare 302 跳转至既有 CloudBase 后台；浏览器已验证真实概览。当时真实 HTTPS 验收为 63/64；本轮整改追加所属 `/assets` 严格路由后已达到 64/64，缺失 JS 返回 404，未改共享托管全局配置。此前首次登录失败的冷启动根因尚未证实。详见[登录与入口验收](evidence/admin-login-20260929/README.md)。

## 仓库事实

| 范围 | 当前事实 | 权威来源 |
| --- | --- | --- |
| 小程序路由 | 58 条：5 条主包、48 条用户分包、5 条管理分包（含网页登录确认页）；2026-10-08 MIW-54 下线超级案例孤儿列表页 1 条、2026-10-07 MIW-49 新增城市选择页 1 条、此前 MIW-42 删除机会死页 3 条、MIW-44 下线知识/游戏/盲盒 9 条 | `config/runtime-pages.json`、`src/app.json` |
| 数据库 | 104 个追加迁移；目标清单为 152 张 runtime 表 | `database/mysql/mip/migrations.lock.json`、迁移生成清单 |
| 管理合同 | 240 个 operation：105 查询、135 写 | `cloudfunctions/mip-admin-api/domain/public-operation-contract.js` |
| Web 开放范围 | 105 查询、123 个受审 mutation | `cloudfunctions/mip-admin-api/domain/public-operation-contract.js` |
| 云函数 | 23 个 `mip-*` 函数目录；数据库核心部署清单为 16 个函数 | `cloudfunctions/`、部署清单 |
| 调度 | 消息和知识采集各有独立 scheduler；均不属于数据库核心函数 | `mip-message-scheduler`、`mip-knowledge-scheduler` 及部署脚本 |
| Web 页面 | 15 个一级页面、13 类详情 | `admin-web/src/` 的路由与页面合同 |
| 管理端形态 | React Web 是唯一完整后台；小程序现场工作台只保留 Web 登录确认、已授权活动、签到码与海报、名单与签到，共享管理 operation 和服务端事实 | `src/packages/admin/`、`admin-web/`、`packages/admin-contracts/` |

## 2026-09-26 收尾进展（部署已完成，完整业务验收待续）

- 用户最新确认：会员协议、等级/权益、任务奖励与勋章均由后台配置，允许明确标记的演示内容。已补齐等级、权益、成长规则、勋章定义编辑及协议保存/用户端读取；任务奖励与勋章发放沿用已有管理能力。示例默认草稿，协议有演示标记；不自动向真实用户发放测试奖励。
- 任务改为服务端按状态过滤后分页，游标绑定筛选条件；切换和分页的非空、并发测试已补充。
- 新增独立合作意向表；详情支持表态、取消、只读名单，个人第二页签读取本人合作意向。计数与头像不再借用第三方引荐事实；新通知不发放未经定义的奖励。
- 现场名单适配真实非空服务端字段；排行榜快速切换采用最后一次请求结果。
- 飞书目录已写入 staging 并回读核对：506 个来源标签（其中 486 个新增）、11 个徽章；保留既有同名 ID、旧引用和历史目录，不自动创建分会或发徽章。
- 通用名片管理已接真实用户档案，增加现有四套模板配置、下架/恢复和版本快照。历史快照从本次上线开始；私人联系方式不复制到历史表。迁移 092/093 已应用，150 张业务表运行权限精确核对通过；五个相关云函数、Web 和小程序开发版已更新，证据见下方会员配置验收。

- 完整 `verify:all` 通过：小程序 245 个测试文件 / 1336 项测试，后台 66 项 React 测试及 149 项合同测试通过；运行预检确认开发者工具已登录、服务端口可用。会员配置本地交互及发布边界见[会员配置验收](evidence/membership-config-20260926/README.md)。
- 维护者恢复 Device Flow 授权后，五个变更云函数部署及完整 `cloud:verify` 通过；Web 正式域名已更新，小程序开发版 `0.2.0.20260926.1` 已上传。真实后台已保存演示协议与权益草稿，小程序实拍确认协议版本 1 和演示正文。

- 本轮人工筛选与等级页已复核；全路由遍历及未通过项、后台导出失败详见[收尾验收记录](evidence/closeout-20260926/README.md)。新版云端、Web 和小程序开发版发布已完成；完整交互、非空导出和真机验收仍未完成。

## 环境状态

最新 Web 与 CloudBase 后台状态见上方 2026-10-01 checkpoint、[常用功能证据](evidence/admin-common-cua-20261001/README.md)和[活动专项证据](evidence/admin-events-cua-20261001/README.md)；9 月 30 日 18 时公开 HTTPS 阻塞已解除，66/66 复验通过。此前[43 步第三轮修复](evidence/prototype-review-round3-20260926/README.md)已同步机会内容安全权限并经真实新增/编辑回读；反馈保存返回、隐私偏好覆盖和删除竞态已修复，43 步对照页全部图片可加载。24 项目标角色/数据与其余交互分支仍待补测，不能读作全部业务通过。9 月 29 日未重新上传微信版本；下表保留其他环境之前的发布记录。

| 环境 | 当前已核实状态 | 不能外推 |
| --- | --- | --- |
| 当前 CloudBase Web + 管理 API（staging） | 2026-10-01 Web `d96a34c3` 及 4 个常用功能业务函数已部署；205 个运行时源码文件、代码包与 14 个公开静态文件回读一致，真实活动及常用功能读写/导出分支通过；任务/Banner 微信审核出站已启用，入站/网关/域名方式保留 | 首轮任务列表 503 后恢复，冷启动根因未确认；支付为 TEST；不代表全角色、53 条完整产品场景或真机验收通过 |
| MIP staging | 2026-09-26 已应用 94 个迁移、150 张 runtime 表；五个变更核心函数部署和完整 `cloud:verify` 通过 | 不代表所有页面、真机支付或正式生产环境通过 |
| React Web 生产 | 2026-09-26 main 部署 `aad79fa2`；正式域名真实会话、协议保存和权益草稿创建通过 | 不代表全部 mutation、非空导出、支付或外部消息通过 |
| 小程序开发版 | `0.2.0.20260926.1` 在完整 `pnpm verify:all` 后上传成功，业务代码 `f78c3a3b` | 尚未切换体验版、提审或正式发布 |
| 小程序运行时 | 部署前一次 Node 22 尝试有 69/70 路由进入接受态；此前三次自动截图失败且重连超时。本轮开发者工具人工复核等级页与“相关机会”原位切换，并更新并排 HTML 中这两步的实拍，详见[本地验收证据](evidence/latest-requirements-2026-09-23/README.md) | 不构成 70/70 路由、43 步逐帧同条件比较、完整交互或真机验收 |
| 正式小程序 | 正式 AppID、商户、回调、通知、AI/provider 和真机能力仍待验收 | 不能用 staging、浏览器或开发者工具结果代替 |

## 已形成稳定底座

- 用户、玩家/嘉宾、城市分会、会员权益、订单、活动、机会、成长、任务、游戏化、知识内容和消息使用服务端事实模型。
- 玩家资格、金额、报名、签到、成长余额和管理权限不由客户端计算。
- 平台、城市分会和活动三级 scope，以及七类管理角色，已有 capability、事务内重授权和审计实现。
- `mip_*` 表、`mip/` 对象路径、函数名和部署清单与共享环境中的其他项目隔离。
- 支付 ledger、退款、outbox、站内消息和媒体安全已有代码及聚焦测试。
- 管理端使用渠道中立 DTO、错误合同、trusted principal、transport 和 operation registry。
- React Web 已迁入 `admin-web/`，独立构建、独立部署，并与小程序现场工作台共享服务端合同。
- 消息排期和知识采集分别使用不连接 MySQL 的滚动单次 scheduler；worker 不安装高频定时器。

## 当前缺口

### 证据与运行环境

- 2026-09-26 升级 `weapp-vite 7.3.0`：底部操作栏使用默认深色背景，移除旧兼容文件和空样式，标准模糊仅作增强；排除浏览器 Preflight 后，会员订单按钮白底框实拍确认消失。完整 `verify:all` 与运行预检通过，最终 JS/WXML/JSON/业务资源与旧版本哈希一致。第二轮运行记录 65/70 路由通过，成长/游戏加载、现场名单、身份受限和自动化真实交互仍有待查项；最终样式仅补做聚焦实拍，没有上传或云端部署。详见[升级评估](../research/weapp-vite-upgrade-2026-09-26.md)。
- 已保存部署前运行时摘要与无个人信息的状态截图；部署后自动截图接口与重连失败，仍缺少 70/70 路由及全部严格交互通过的报告。本地 `.tmp/` 报告不可替代真机证据。
- 小程序现场工作台仍需真实设备完成 Web 登录确认、签到码、扫码、海报保存、手工签到和受控撤销验收；React Web 继续按浏览器桌面和手机视口验收。
- 最新流程画布与需求仓库 `role-flows` 是本轮界面依据；旧原型已从需求仓库删除。部署前的 70 路由运行尝试有 1 条受限页和严格交互未通过；部署后截图接口失败，差异记录见 [需求与实现差异](REQUIREMENTS_DIFF_20260922.md)。
- 2026-09-26 重新 fetch 后，需求仓库仍为 `cb5956b`；线上画布的 manifest 与原型文件也与固定来源一致，9 月 22 日之后没有新的上游增量。[本轮复核与下一轮建议](REVIEW_20260926.md)区分实现欠账、内容交付与验收缺口。
- 43 步原型已做[逐步对照](PROTOTYPE_PARITY_20260923.md)；J6-02 的案例时间轴已补到正式页，J6-03 本轮已改为档案内切换“我发布的 / 我想合作”，合作数据来自独立表态事实；部署后实拍待完成。有内容的案例时间轴和 43 步逐帧截图仍待同角色、同数据的实际渲染验证。
- 账号设置的“会员服务协议”已改为读取后台配置；空内容与读取失败分别展示，演示正文明确标记。正式资料盘点见[会员资料盘点](MEMBERSHIP_CONTENT_INVENTORY_20260926.md)，不再作为功能开发阻塞。新代码已部署，真实后台保存至小程序读取已联调通过。
- 2026-09-26 已从用户提供的飞书 Base 完整取得行业、城市/地区及徽章资料，并固化[来源快照](sources/feishu/20260926/README.md)。数据完整性已核对，运行目录已完成接入和回读，保留旧标签 ID/引用并区分“不限”“全国/海外”；不再将行业和城市清单列为缺少资料。徽章发放/回收条件仍只写“后台配置”，本来源不含等级门槛、逐级权益或任务奖励表。
- `weapp-design` 及根 DESIGN 的过期颜色、TabBar 高度/图标限制已校正，设计系统补充了原生安全区和最新画布优先规则；旧 Figma 映射明确降为溯源资料。设计系统 SOT 校验、12 个运行时颜色对照、508 条资料完整性校验及完整 `pnpm verify:all` 通过。本轮属于规范修正，未改页面实现，不视为新增 UI 或真机验收。
- staging 的本轮数据库和函数读回见[部署证据](evidence/latest-requirements-2026-09-23/STAGING.md)；后续环境变更时必须重新生成，小程序仍需独立运行时和真机验收。

### 真机与正式配置

- 手机号授权与换绑、扫码签到、地图、录音、私密视频号和 `web-view` 需要真机。
- 正式 AppID、微信支付商户、支付/退款回调、通知模板和 AI/provider 尚未完成生产验收。
- 正式协议、城市/行业目录、等级规则、勋章、游戏规则、知识内容和价格仍是可替换配置。
- 消息和知识 scheduler 代码已完成；专用 CAM 角色、canary、激活和最终云端读回仍按各自环境证据判断，不用代码存在代替部署结论。

## 证据入口

- [2026-09-23 最新需求本地验收](evidence/latest-requirements-2026-09-23/README.md)（静态门禁通过；小程序运行时和外部能力尚未全过）

- [2026-09-14 消息分页与已读修复发布](evidence/2026-09-14-inbox-release.md)（消息函数已更新，小程序实际调用验证未读数为 0，开发版本已上传；全量云端管理验收仍受 CAM 鉴权阻塞）

- [2026-09-15 访客已读与感兴趣交互修复](evidence/2026-09-15-visitors-interest-fix.md)（机会服务已更新并通过健康回读；真机复测待完成）
- [2026-09-14 微信支付修复与验收](evidence/2026-09-14-wechat-pay-fix.md)（CloudPay 查单、通知和内部签名已修复并部署；用户确认会员支付正常，活动支付及退款闭环仍待验收）
- [历史 React Web 线上验收（2026-08-28）](evidence/admin-web-live-2026-08-28-react/README.md)（只作历史追溯；当前 Web 状态以本文件环境状态表和 2026-09-26 部署记录为准）
- [早期 React Web 线上证据](evidence/admin-web-live-2026-08-28/README.md)（只作历史追溯）
- [旧小程序完整管理端响应式密度验收](evidence/admin-density-2026-08-26/README.md)（只作历史追溯，不证明当前现场工作台）
- [历史设计固定证据](evidence/figma-2026-08-25/README.md)（只作历史追溯，不作为本轮设计依据）

证据的适用层级和外推限制以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。
