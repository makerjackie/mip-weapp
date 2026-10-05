# MIP 当前状态

更新日期：2026-10-05（会员方案后台改价（MIW-35）；会员/成长整轮：玩家等级会员按钮分态、经验值详情独立页与后台可配置规则文档、首笔入会人工审核流、邀请卡图片与嘉宾关系（MIW-27）；勋章后台配置补齐 + 评审修复：勋章形象直接上传、获得条件与身份/荣誉分类暴露、草稿 key 去演示前缀、勋章形象生命周期与预览修复（MIW-25）；填写信息页一句话介绍字数与区块图标对齐设计稿（MIW-26）；此前 2026-10-04：用户信息页精简、通用游客登录单按钮流程、活动详情指引链接、原生分享邀请归属、嘉宾卡统一组件化；其他环境证据保留各自采集日期）。

本文是路由数、迁移数、operation 数、部署状态和当前缺口的唯一文档入口。产品规则见 [REQUIREMENTS.md](REQUIREMENTS.md)，验证口径见 [ACCEPTANCE.md](ACCEPTANCE.md)，逐域状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。

2026-10-05（评审修复）：勋章配置 diff code review 后修复五项。① 孤儿清理守卫：`mip-media-api` cleanupOrphans 增加 `mip_badges.image_asset_id` 引用守卫（此前 `BADGE_IMAGE` 随 `PURPOSE_POLICIES` 自动进入清理范围，已绑定勋章的形象会在 24 小时后被当孤儿删除，并导致勋章无法再编辑）；② 读取侧 status 谓词：`mip-growth-api` 与 `mip-opportunities-api`（公开档案/人物卡 loadPublicBadges 新增素材 join）的勋章素材 join 统一加 `asset.status = 'READY'`，非 READY 素材回退到 `image_url` 手填兜底；③ 后台预览贯通：`mip.admin.badges.list` DTO 新增 `imagePreviewUrl`（素材优先解析，`admin-media-projection` URL_KEYS 扩展后自动换临时 HTTPS），勋章表单编辑时可预览已保存形象，AssetUploader/AssetListUploader 上传后改用本地 blob 预览（此前渲染 `cloud://` 必然裂图）；④ 错误文案去 Banner 化：`mip-admin-api` 的 `IMAGE_ASSET_INVALID`/`IMAGE_NOT_OWNED` 文案改为素材中立措辞（`mip-banners-api` 自有映射保持不变）；⑤ 补清空回读测试：勋章形象从非空到清空的服务端回读（`imageAssetId: ''` 显式清空）纳入 React 测试。门禁 `pnpm verify` 与 `pnpm admin:web:verify` 全绿（React 156 项）。

2026-10-05：勋章后台配置按 MIW-25 核对结论补齐三项（P0+P1）。① 勋章形象直接上传：新增 `BADGE_IMAGE` 媒体用途，贯通 admin-web 表单（AssetUploader）→ Web BFF（`server/admin-media-upload.ts`）→ `mip-admin-api` → `mip-media-api` 四层用途白名单与 `badges.manage` capability，迁移 098 为 `mip_badges` 增加 `acquire_condition` 与 `image_asset_id`（外键挂 `mip_media_assets`，RESTRICT），按 Banner 模式只存素材外键、读取时 LEFT JOIN 并 `COALESCE` 云文件（临时 HTTPS 地址不过期落库），服务端校验素材 READY/BADGE_IMAGE 用途/PNG-JPEG/归属；② 获得条件与分类：`acquire_condition`（≤300 字，仅作为说明展示给用户）与 IDENTITY/HONOR 分类暴露到后台列表 DTO、保存校验与表单，`mip-growth-api` 勋章集与小程序勋章页/详情页带回分类与获得条件；③ 草稿 key 前缀修复：会员配置草稿 key 由纯随机 UUID 生成，去掉 `demo_` 前缀（避免真勋章被误当演示数据）。范围裁定（用户确认）：不做有效期字段——勋章只有组织发放日期（既有 `awarded_at`）；不做获得条件自动发放——勋章仍全部由管理员人工发放。本地门禁 `pnpm verify` 与 `pnpm admin:web:verify` 全绿（迁移 99 个、Web 合同 234 项、React 153 项），未部署、未应用迁移到目标环境。

2026-10-01：活动详情页的活动评论、活动相册和加入系统日历三个实现侧超集区块已按设计稿复核整体移除（含管理端相册治理、`events.album.manage` / `events.comments.manage` capability、媒体 `EVENT_ALBUM` purpose 与 outbox 评论通知策略）；路由数与管理 operation 数已同步。`mip_event_album_photos` 表与活动相册配置列按追加迁移守卫保留为 dormant 历史数据。该轮改动仅完成本地验证，未重新部署。

## 结论

- 后台产品验收唯一入口已统一为 [admin-web/ACCEPTANCE.md](../../admin-web/ACCEPTANCE.md)，替换历史交互改造全勾选清单。五份上游原件、伙伴提交历史、原始缺口见[9 月 29 日审查](evidence/admin-audit-20260929/README.md)，当前实现/验证状态见[管理端矩阵](COVERAGE_MATRIX.md#管理端)。本轮可独立推进的整改已发布至既有 CloudBase staging 目标，不能把原审查当作当前未修复清单。
- 最新完整 `pnpm verify:all` 通过：根工程 1484 项、Web 合同 233 项、React 152 项。本次常用功能修复已部署，4 个业务函数的 205 个运行时源码文件及 Web BFF 的 14 个公开静态资产回读一致，源码 `d96a34c3`；[常用功能 CUA 证据](evidence/admin-common-cua-20261001/README.md)记录真实读写及明确未验分支。兼容迁移 094/095 已应用；此前九个业务函数全部部署，下载代码与本地 JS 一致且 MySQL 健康通过。2026-09-29 概览改版和机会恢复招募增量已发布到既有 CloudBase staging：真实 HTTPS 66/66、14 个读模块、`mip-admin-api` 274 个 JS 下载比对及健康检查通过；演示对象结束/下架后编辑保存、恢复/重新招募 14 项通过且数据还原。三个实际 CSS 视口和概览交互已复核，详见[增量验收记录](evidence/admin-overview-20260929/README.md)。53 条产品场景仍未全部验收，17 条受未确认规则影响。

当前产品形态为“小程序用户端 + 五路由小程序现场工作台 + React Web 主后台”。会员、活动、机会、成长、任务、游戏、内容、消息、订单、支付和运营管理已经形成统一的服务端事实与本地实现底座，不需要整体重写。

仓库清单当前为 69 条小程序路由、102 个迁移（均已锁定）、240 个渠道中立管理 operation（105 查询、135 写）和 16 个数据库核心函数。Web 合同允许其中 105 个查询与 123 个受审 mutation。以上数字只描述当前代码合同，不自动证明每个 action 均有真实实现，更不证明运行时、云端或生产通过；部署与验收边界见下文。

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

## 2026-10-05 会员方案后台改价（MIW-35）

客户提出 6000 元/年的会员价格需要后台可配置。此前价格虽由服务端下发（`mip_membership_plans.price_cents`，下单时快照 `amount_cents` + `product_snapshot_json`），但全仓库对该表只有 SELECT，改价只能直改数据库，无审计、无并发保护。本轮补齐「只改价」闭环，管理合同增至 240 operation（105 查询、135 写；Web 开放 105 查询、123 受审 mutation），admin-contracts 已再生：

- 契约：`mip.admin.membershipPlans.list`（QUERY，返回该 app 全部方案含 TEST/LIVE 两 stage 与 status/version）与 `mip.admin.membershipPlans.save`（受审 mutation，入参 `planId`/`expectedVersion`/`priceCents`，幂等键由 Web BFF 转发）。
- 服务端：`mip-admin-api` 新增 `domain/membership-plans.js` + `domain/repositories/membership-plans.js`（照 `membership-content` 成对结构），挂 MEMBERSHIPS manifest。保存走事务：`lockMutation` → `claimOptional` 幂等 → `SELECT ... FOR UPDATE` 校验 `expectedVersion`（冲突抛 CONFLICT「请刷新后重试」）→ 带版本守卫的 `UPDATE price_cents, version+1` → 审计 `MEMBERSHIP_PLAN`（metadata 记新价 `priceCents` 与旧价 `previousPriceCents`）。价格校验 1..100000000 分（¥0.01–¥100 万）；方案不存在抛 NOT_FOUND。读复用 `growth.read`、写复用 `growth.configure`（与会员协议保存同一权限，未新增能力、未动角色种子）。`RUNTIME_TABLE_PRIVILEGES` 中 `mip_membership_plans` 由 `['SELECT']` 扩为 `['SELECT', 'UPDATE']`（部署时需跑 `scripts/converge-mip-runtime-grants.mjs` 对账真实 GRANT，此前该表运行时账号只读）。
- 后台：React「成长」页新增「会员方案」页签，行内只读展示名称、TEST/正式 Tag、时长、状态，价格以元为单位用 InputNumber 编辑（元→分 ×100 取整校验），保存带该行 `version`，成功提示「已保存，仅新订单按新价格下单」。
- 约束：名称/时长/状态只读，不做新建/删除/上下架（当前仅一条年卡方案，等客户提出再扩展）；小程序端零改动。改价只影响之后的新订单（已支付订单金额与快照不可变），TEST 与 LIVE stage 相互独立，均为既有机制保证、本轮未新增代码。
- 验证：完整 `pnpm verify` 与 `pnpm admin:web:verify` 通过（新增 `tests/membership-plans.test.js` 7 项：权限、服务端绑定、校验、版本冲突、幂等重放、审计新旧价、list 投影；admin-web 面板 React 测试补会员方案渲染、元→分换算、只读形态与冲突提示）。当前为 verified-local，未部署、未做后台改价→小程序下单页的真实链路验收；并发编辑两人冲突、审计留痕留待 browser 验收。

## 2026-10-05 填写信息页字数与图标对齐

MIW-26：填写信息页（`packages/member/mip-profile`）「一句话介绍你的工作和背景」交付还原分支硬编码 `0/300`，改为真实计数 `{{(figma.intro || '').length}}/160`（160 为服务端契约 `boundedText(headline, 0, 160)`；生产表单此前已是 160，未改）。该区图标按设计稿字形对齐：`draft-line` / `survey-line` 补入 mip-icon 注册表，页面四个区块标题统一为设计稿字形（基础信息 `contacts-1-1`、代表行业与当前身份状态 `draft-line`、一句话介绍 `survey-line`），同时消掉本页 3 个 `t-icon` 外来图标与 4 张裁坏的还原贴图。前后对比见[填写信息字数与图标证据](evidence/20261005-miw26-profile-intro/README.md)。完整 `pnpm verify` 通过（根工程 1504 项测试）；Layer 3 像素 97.27% → 97.29%。参考稿 `figma-restored`（ame-project 仓库）此细节仍是 0/300，未改设计证据仓库。

## 2026-10-05 活动详情「与你互动」卡片（MIW-28）

活动详情参与人数模块的已签到态新增「与你互动」区块（黄色标题 + 「我的心动 N / 对我心动 N」两枚胶囊，深链参与人页对应心动 tab）。口径经客户确认（2026-10-05）：已签到即展示，0/0 也显示，废止 journey-review J0-01 的空态隐藏规则（设计师批注 2133:3831 不再适用）；未签到整卡隐藏。服务端仅对 `registration_status = 'ATTENDED'` 的查看者下发 `interactionSummary`，计数与参与人页心动 tab 同人群（received 侧含投票者资料 JOIN、拉黑双向过滤）；计数属装饰性数据，查询失败只隐藏卡片、不阻断详情主载荷，并随详情其余独立子查询并行执行。客户端可见性只跟随服务端 `canInteract` 与 `interactionSummary`，不再重复推导签到状态。

代码评审曾发现该计数 SQL 把拉黑片段（裸 `NOT EXISTS`）拼进 JOIN ON 缺少 `AND` 前缀，会使已签到用户的 `mip.events.detail` 整体 1064 失败；已改为片段置于 WHERE 并补 `AND`，拆为两条独立计数查询，测试新增 `AND NOT EXISTS` 连词回归守卫与计数失败降级用例。完整 `pnpm verify` 通过。真机上的签到后卡片展示与心动深链仍待验收。

## 2026-10-04 通用游客登录引导提取

活动详情、机会列表和我的页此前各自内联同一套游客登录引导（未登录/未绑手机号 → 弹层手机号授权；已绑手机号的退出账号 → 显式「重新登录」恢复；新账号 → 补资料后回原页；协议等剩余项 → access 页；就绪 → 原页就地继续），已提取为共享控制器 `src/modules/mip-identity/guest-login-flow.ts`（MIW-20）。页面只注入路由、token 槽位、弹层状态与原意图的就地执行，不再各自复制恢复分支。已绑手机号的账号再次登录不重复授权手机号——授权 code 一次性、服务端换绑后 `phoneBound` 随快照持久，由服务端决定 PHONE 项是否已满足。

同日产品调整（仍属 MIW-20）：`mip-login-sheet` 双按钮合并为单主按钮。退出过的老账号（本地有退出记录）点主按钮先按 OpenID 恢复会话，已绑手机号直接完成登录、不再弹原生授权；服务端确认未绑时主按钮原位切回「微信手机号授权」形态再弹原生授权（原生授权窗只能由真实点击调起，无法并入同一次点击）；新游客直接进手机号授权形态。授权后仍按协议 → access 页、新用户 → 补资料、就绪 → 原页就地继续。数据键 `loginSheetAllowSignIn` 更名 `loginSheetRestoreFirst`，组件属性 `allowSignIn` 更名 `restoreFirst`。journey-review J0/J1 口径由 `tests/mip-guest-login-flow.test.ts`（19 项）与既有页面测试共同钉住。完整 `pnpm verify:all` 通过（根工程 1504 项测试）。手机号授权与换绑仍需真机验收，A1–A4 维持矩阵口径不变。

## 2026-10-05 玩家等级会员按钮与经验值详情页（MIW-27）

玩家等级页（客户口中的「会员」页）底部按钮按会员事实分态：未加入（游客）保持「立即加入」；已加入玩家未进续费窗口时「邀请加入」改为黄底 primary 全宽（此前恒为黑底 secondary，属修正）；进入到期前 3 个月窗口后「立即续费」黄底居右、「邀请加入」退居左侧黑底黄字。右上角「经验值详情」入口下移至与 EXP 进度条同一水平线并放大一档；点击不再滚动到底部原地展开，改为跳转新增的 `packages/member/mip-experience-details/index` 经验值详情页（figma 1948:14177），「规则详情/经验值明细」双页签，明细按 EXPERIENCE 指标由服务端过滤（`mip-growth-api` listEntries 新增 metric 参数，非法值回退全量，保住 keyset 分页游标）。路由契约三处（app.json / runtime-pages.json / project.json）同步至 69 条。判断口径：明细卡副行取流水时间（规则表无描述列，设计稿副行文案无数据来源）；规则详情页签按占位设计帧沿用明细卡骨架；等级与权益、成长数据原展开区块随展开交互一并移除（无设计帧承载）。完整 `pnpm verify` 通过。

同日追加第二轮：「立即加入」首笔付费不再即时生效——ledger 为首笔付费会员在 `mip_membership_approvals`（迁移 101，每用户至多一条）自动落待审核记录，会员资格投影为 PENDING；已拥有过会员（ACTIVE/EXPIRED/REFUNDED）或运营开通资格的玩家按续费处理，不设审核。管理后台「成长」页新增「入会审核」分区，行内受控弹窗同意/驳回（驳回必填审核意见，会员链版本乐观锁，留审计并写 outbox `membership.approval_decided`，outbox 按 OPERATION_RECEIPT_SUPPRESSED 消化不生成站内消息）；同意后资格立即生效（到期自支付起算，审核时长不补偿，特殊补偿走运营开通），驳回置 REVOKED，复议通过同链恢复。小程序端按服务端快照如实展示：支付结果页提示「管理后台审核通过后生效」，玩家等级页/会员方案页展示「审核中」并暂停重复下单，权益页展示待审核形态；身份投影保持嘉宾不变。「邀请加入」卡片暂用品牌默认封面并记录嘉宾邀请关系。管理合同增至 238 operation（104 查询、134 写；Web 开放 104 查询、122 受审 mutation），admin-contracts 已再生。

同日评审修正（第三轮，取代第二轮的逐条规则文案方案）：「经验值详情-规则详情」不是逐条规则卡，而是一整段由管理后台配置的文本（与经验值明细的逐条流水卡不同）。改走既有 membership-content 文档通道：`mip_app_settings` 新增 `EXPERIENCE_RULES_TEXT` 键，作为第三种文档 `experience-rules`（复用两份协议的版本乐观锁、幂等键、审计与演示标记，无需新迁移，管理合同 operation 数不变——文档枚举不属公开契约固定项）。管理后台「成长」页新增「经验值规则说明」页签（标题/正文/演示标记），成长奖励规则编辑弹窗移除「规则说明」字段、只维护奖励数值并以提示指向该页签；第二轮迁移 098 的 `mip_growth_rules.description` 列按追加迁移政策保留但全链路不再读取（admin 校验/投影、growth-api DTO 与 SELECT、小程序 `GrowthRule` 类型同步移除）。小程序「规则详情」页签读取该文档整段正文按 `whitespace-pre-wrap` 纯文本展示（保留换行），未配置时展示空态说明；页面不再依赖 getSnapshot。

## 2026-09-29 后台登录与临时入口

密码登录已发布有限等待与临时失败重试，完整门禁通过。临时入口 https://mipadmin.01mvp.com 以 Cloudflare 302 跳转至既有 CloudBase 后台；浏览器已验证真实概览。当时真实 HTTPS 验收为 63/64；本轮整改追加所属 `/assets` 严格路由后已达到 64/64，缺失 JS 返回 404，未改共享托管全局配置。此前首次登录失败的冷启动根因尚未证实。详见[登录与入口验收](evidence/admin-login-20260929/README.md)。

## 仓库事实

| 范围 | 当前事实 | 权威来源 |
| --- | --- | --- |
| 小程序路由 | 69 条：5 条主包、59 条用户分包、5 条管理分包（含网页登录确认页） | `config/runtime-pages.json`、`src/app.json` |
| 数据库 | 102 个追加迁移；目标清单为 152 张 runtime 表 | `database/mysql/mip/migrations.lock.json`、迁移生成清单 |
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
