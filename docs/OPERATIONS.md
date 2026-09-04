# Operations

React Web 是日常运营和完整管理的唯一界面，入口为 `admin-web/`。小程序的 `packages/admin/dashboard` 只进入现场工作台，用于 Web 登录数字码确认、已授权活动、签到码与海报、名单和签到；`packages/admin/web-login-confirm` 只处理网页动态小程序码的身份门禁和明确确认。它们都不是第二套后台或报表大屏。服务端入口统一为 `mip-admin-api`，两端复用同一 DTO、capability 和审计合同。除非本页明确写“现场工作台”，下文“管理端”均指 React Web。

## 初始化与部署

数据库、云函数、支付、Owner 和演示数据的首次初始化统一按 [部署手册](DEPLOYMENT.md) 执行。本页只保留上线后的运营和受控恢复命令。

为在微信开发者工具中验证当前非演示 Owner 的活动互动页，可在 development/test 环境单独创建一条固定的 `ATTENDED` 历史报名；MIP 专用 staging 还必须追加 `--confirm-staging-demo`：

```bash
pnpm event:interaction:seed -- \
  --confirm-env=<EnvID> \
  --confirm-app-id=<当前 AppID> \
  --confirm-owner-event-interaction
```

只检查参数和写入 SQL，不连接 CloudBase：在上述命令后追加 `--validate-only`。

该命令从 `.env.local` 的 `MIP_OWNER_PHONE` 通过与 Owner bootstrap 相同的 AppID 范围哈希定位当前 Owner，并排除 `seed.demo.json` 中的演示用户。它只允许 `development`/`test`，或带唯一 `--confirm-staging-demo` 的 MIP 专用 staging；所有允许环境都必须使用 TEST catalog 和非 live payment，非 staging 禁止携带该确认参数，production 永远禁止。固定活动必须属于当前 AppID，标题精确为“MIP 城市互动交流会”，状态为 `ENDED`，类型为 `FREE`，结束时间早于数据库当前 UTC 时间，并登记在状态为 `READY` 的 demo seed manifest 中。执行前还会确认当前 Owner 没有该活动的任何报名，且固定报名 ID 在所有 AppID 中均未占用；任一条件不满足都会停止。

该命令只向 `mip_event_registrations` 插入一条 `ATTENDED` 报名，写入后重新查询固定状态；输出不含 AppID、环境、用户 ID 或手机号。该报名是运行时验证夹具，不修改 `seed.demo.json`，不创建签到、心动、反馈、成长、outbox 或审计事实，不用于 production/live，也不代表生产业务数据。未来若要移除，需由数据库负责人按固定报名 ID 在确认的 development/test/staging 环境中单独处理；不要通过通用 seed 或非 MIP 表清理。

核心函数需要最小化更新时，使用 `pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user> --only=<exact mip-* function name>`；目标必须精确命中核心部署清单中的单个函数。

首个 Owner 通过本机 `.env.local` 的 `MIP_OWNER_PHONE` 定位。该手机号必须已由同一 AppID 的微信真机流程绑定；脚本只使用与身份服务相同的 AppID 范围哈希查询，不解密或输出号码。候选还必须是 ACTIVE、非 demo、已有昵称和主分会，并已接受当前 `MIP_AGREEMENTS_JSON` 的全部协议版本。需要额外消除操作歧义时可传 `--user-id=<用户 UUID>`，但该 ID 必须与手机号唯一命中的用户严格一致。

支付模式为 `live` 时，支付部署命令还必须追加 `--confirm-live`。demo seed 默认只允许 development/test；MIP 专用 staging 环境还必须同时传入 `--confirm-staging-demo`，并继续满足 TEST catalog、非 live payment 和 exact EnvID 确认，production 永远禁止。它会以固定 ID 写入可重复执行的城市、标签、玩家/嘉宾、测试会员订单与权益、2030 活动、报名、机会、合作卡、案例、公告、知识、消息、任务、成长、赛季、排行和盲盒。种子附带 6 张虚拟人物头像、4 张活动封面和 2 张运营 Banner；执行时通过 CloudBase 存储上传或复用同一内容的对象，复核字节数与 ETag 后再写入 `READY` 媒体记录，数据库只保存永久 `cloud://` 文件 ID。执行前写入 `PENDING` 清单，完整验证后改为 `READY`，并保留版本化清单；Owner 初始化始终排除其中的演示用户。Banner 依赖真实云媒体素材，不写入无效文件引用。手机号未绑定、候选资料或协议不完整、命中不唯一，以及可选 user ID 不一致时都会停止且不授予权限。

当前固定活动包含 4 场 2030 年周四、10:00–12:00 的深圳福田 MIP 早会，以及 1 场历史互动活动；5 场活动均有独立的演示封面，场地和地址均标注为演示数据。前 3 位演示用户具有测试订单和有效演示权益；它们不可用于推断或恢复真实会员缴费。

`owner:showcase` 是另一条仅用于当前真实 Owner 验收的展示夹具通道。它通过 `MIP_OWNER_PHONE` 定位已完成手机号绑定、协议确认且非 Demo 的唯一用户，只补齐活动报名/TEST 活动订单、任务、勋章和资料展示事实，不创建或绕过会员权益。development/test 仍按原命令执行；MIP 专用 staging 还必须追加 `--confirm-staging-demo`，并继续确认 exact EnvID、exact AppID、TEST catalog 和非 live payment。production 永远禁止。`membership:test` 同样可用于 staging，但必须追加 `--confirm-staging-demo`，且 ledger 必须部署有效的独立 `MIP_TEST_MEMBERSHIP_HMAC_SECRET`；它始终通过内部签名调用受保护 ledger，由 ledger 重算订单与权益，并复核手机号绑定、协议、唯一 Owner 和非 Demo 身份，不能由脚本直接 SQL 写会员事实。没有有效专用 HMAC 时 staging 会员操作和云验收均停止。

staging Owner 的 TEST 会员操作示例：

```bash
pnpm membership:test -- \
  --operation=grant \
  --plan-key=annual_test \
  --confirm-owner \
  --confirm-env=<EnvID> \
  --confirm-app-id=<AppID> \
  --confirm-ledger=<ledger-function-name> \
  --confirm-catalog=TEST \
  --confirm-test-membership=grant \
  --confirm-staging-demo
```

活动创建/编辑、状态变更和撤销签到只通过 `mip-admin-api` 执行。`mip-events-api` 不接受这些管理写操作，避免同一活动事实存在第二套状态机、退款和权限路径。创建、编辑、复制、取消、报名审核、导出和退款只在 Web 提供界面；现场工作台只提交签到海报、签到和受控撤销意图。

- 分会：平台范围、城市分会、主分会和分会成员归属
- 活动：Web 使用统一列表 → 单场管理 → 编辑/名单/相册/导出/团队；可将任意授权活动复制为独立草稿，活动时间按周顺延，报名、订单、签到、相册和消息不会复制
- 订单：`mip_orders` 统一展示会员、付费活动和单内容订单；退款由 ledger 状态决定
- 退款：服务端角色校验；管理端只提交订单/退款意图，金额和权益由 ledger 决定；到账后由 ledger 重算权益，不能手工改玩家状态
- 名册导出：含手机号的导出走安全票据，页面只显示掩码票码
- 公告：使用独立 `announcements.manage` capability；平台运营维护全平台和分会公告，城市管理员只能维护本分会公告
- 任务：使用独立 `tasks.manage` capability；平台负责人和平台运营配置全员或指定成员任务、截止时间和单个模板，按当前 AppID 成员范围搜索并批量派发或软撤销，发布、下架和软删除任务，并查看或导出完成流水
- 勋章：使用独立 `badges.manage` capability；维护目录、排序与启停，授予或撤销玩家勋章并保留审计。仍在佩戴的获授事实先取消佩戴，再撤销，不物理删除历史
- 游戏化：使用独立 `game.manage` capability；平台负责人和平台运营维护赛季、队伍、有效会员成员、每周对阵、服务端结算和排行快照。管理端不输入比赛分数，结算和团队/个人排行只从当前 AppID 的成长流水与账户事实生成
- 举报：使用固定类别和可选短说明；审核使用独立 `community.reports.manage` capability、版本冲突保护和逐笔原因，无批量封禁
- owner 引导：使用上方带环境和 owner 确认参数的命令，拒绝 demo 身份；手机号、导出、退款、角色变更和签到覆盖必须使用对应 capability

现场工作台只列出当前账号有权限的活动，并提供签到码与海报、脱敏名单搜索、签到状态和手工签到。现场人员只拥有本场活动的只读名册与签到权限，不授予手机号原文、报名审核、导出或消息发布能力。需要联系参与者时由活动负责人或管理员在 Web 中按明确用途使用独立 `users.phone.read` capability。

游戏化只向当前有效会员开放。赛季结束、周赛结算和排行生成都写入不可变或版本化快照，后续成长值变化不回写历史结果。游戏币使用服务端权威账户与不可变流水，发放、消费和盲盒核销不得由客户端提交金额或结果。正式 PK 规则、等级阈值和队伍大本营视觉尚未提供时使用仓库内可替换的中性默认配置，不能把默认配置描述为正式赛事规则。

签到确认使用 `events.checkin.manage`；撤销误签到使用更窄的 `events.checkin.undo`，只授予活动负责人、活动管理员、城市管理员和平台运营，不授予现场人员。撤销必须提交 1–120 字原因、当前报名版本并追加审计；签到和撤销均追加 transition/outbox，撤销只冲销本轮签到实际入账的成长值，重试与乱序不重复入账。报名恢复为 `REGISTERED`，不删除到场记录。

机会草稿归档使用 `opportunities.archive`，只授予平台负责人和平台运营。归档必须提交当前版本和原因；存在引荐、兴趣、订单、公告或 outbox 事实时拒绝归档。详见 [机会草稿归档](OPPORTUNITY_ARCHIVE.md)。

城市分会目录仅允许拥有平台范围 `branches.manage` capability 的账号维护。分会标识创建后不可修改，名称、城市和简介由服务端规范化，编辑和启停使用版本校验并追加审计。停用前服务端会锁定分会并检查启用成员、城市管理员、已发布活动和已发布机会；任一计数不为零时整笔拒绝，不物理删除分会，也不由客户端推断是否可以停用。

用户、活动参与者、活动订单、全部订单和成长流水导出由服务端重新查询当前事实，生成私有 `mip/exports/<appScope>/` XLSX。票据绑定 AppID、请求人、权限范围和一次性令牌；含手机号文件还会重新校验 `users.phone.read`。Web 在短租约内下载文件，下载成功后消费票据并尝试删除云文件；不向浏览器返回对象 key 或 `cloud://` fileID。现场工作台不提供导出。默认上限是 5000 行和 8 MiB，可在部署时用 `MIP_EXPORT_MAX_ROWS` 与 `MIP_EXPORT_MAX_BYTES` 在受控范围内调整。

用户举报由 `mip-community-api` 只追加到 `mip_reports`，相同用户和 `requestId` 只生成一条事实；网络重试必须复用同一请求标识。提交举报不产生目标用户消息，也不自动封禁。运营审核仅向 `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS` 授予平台范围 `community.reports.manage`，通过 `expectedVersion`、1–300 字原因和追加审计迁移 `PENDING → REVIEWING → RESOLVED | DISMISSED` 状态。列表只返回遵守公开可见性的资料摘要，不返回手机号、OpenID 或内部用户 ID；审核结果不自动封禁或隐藏用户。用户屏蔽写入 `mip_user_blocks`，解除屏蔽保留版本和时间，不物理删除关系。

公告管理向 `PLATFORM_OWNER`、`PLATFORM_OPERATIONS` 和 `BRANCH_ADMIN` 授予独立 `announcements.manage` capability。平台角色可维护全部范围，城市管理员只能维护自身分会；服务端同时校验编辑前范围与提交后的新范围，禁止借编辑跨范围移动。保存草稿执行内容安全检查，发布、撤回、置顶和编辑均校验版本并追加审计。公告不物理删除，公开端只读取已发布且位于展示窗口内的内容；详情关联只允许同 AppID 的活动或机会。

通知和 outbox worker 默认不安装定时器。业务函数在同一事务写 outbox；运营可用 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10` 受控恢复积压。异常中心读取 `mip_outbox_events`、支付/退款、媒体、消息投递和 AI 草稿状态，不通过页面菜单越权修改事实，完整权限和脱敏合同见 [异常中心](OPERATIONAL_EXCEPTIONS.md)。

消息投递复核由拥有平台范围 `messages.delivery.review` 的负责人或运营在异常中心执行：先刷新证据并认领，再选择核对或结束。核对只读取并收敛当前数据库事实；投递任务的核对由 `mip-admin-api` 使用 `MIP_NOTIFICATION_FUNCTION_NAME` 和 `MIP_NOTIFICATION_HMAC_SECRET` 签名调用 `mip-notification-worker`，不得从客户端直调。`UNKNOWN` 不允许自动重放；运营核对 provider 记录后只能以 `UNKNOWN_NO_REPLAY` 和必填说明关闭本次复核，如需新发消息必须走新的业务发布流程。网络失败时保留同一幂等键重试；证据或版本变化时刷新记录后重新操作。

部署前必须给 admin 函数配置与 worker 一致的内部 HMAC 密钥，并读回确认 worker 仍禁止客户端调用。仓库中的迁移 lock 与函数代码不代表目标环境已经部署；必须在目标环境应用 `041_message_delivery_reviews.sql`、部署 admin/worker 配置，并读回验证数据库权限、函数环境变量和客户端调用规则。

消息活动可在 `READY` 状态设置 UTC 定时发布时间。计划、活动指针、权限快照来源和执行结果保存在 MySQL；到期执行会重新校验发起人状态、实时角色、策略和管理范围。独立的 `mip-message-scheduler` 不连接 MySQL，只保留一个 `mip-message-campaign-next` 滚动单次 timer：每次指向所有允许 AppID 中最早的可执行计划，没有计划时关闭。任何连接数据库的函数仍不安装 timer，也不使用固定频率轮询。

调度函数运行时只允许更新/读取自身 trigger，以及调用固定的 `mip-admin-api`；由于腾讯云 CAM 的 `InvokeFunction` 不支持资源级授权，该 action 的资源只能填 `*`，目标限制由固定函数名、内部 HMAC 和专用角色共同完成。新建函数由确认式部署命令使用 raw SCF `CreateFunction` 直接绑定专用角色，不经过会默认注入共享 `TCB_QcsRole` 的 CloudBase 创建路径；创建 trigger、配置 128 MB 预留并发和异步失败重试也只由该命令完成。SCF cron 时区不靠代码猜测：首次部署先启动 canary，确认同一个 trigger 已按预期时间触发并自动关闭，再用匹配 generation 的独立激活 HMAC 切换到普通排期。激活后的 DISPATCH 参数持续保留 canary generation，转换后 reconcile 中断时可用同一激活命令续跑。排期只接受 2100 年以前的 UTC 时间。

业务数据库提交与 post-commit scheduler 调用不是同一个原子事务。进程若恰好在数据库提交后、调用 scheduler 前崩溃，本架构无法消除该窗口；运营应使用同一幂等请求重试，或运行下方手工 runner 重新处理并恢复最近唤醒计划。

自动唤醒无法确认或需要人工恢复时，继续使用原有五分钟 HMAC 有效期的受控命令：

```bash
pnpm message-campaigns:run-due -- \
  --confirm-env=<EnvID> \
  --confirm-message-dispatch=mip-admin-api \
  --confirm-message-scheduler=mip-message-scheduler \
  --limit=5
```

需要排空时追加 `--drain --max-batches=100`；单批 `--limit` 只允许 1–10。命令读取已部署 `mip-admin-api` 的 `MIP_MESSAGE_DISPATCH_HMAC_SECRET`、AppID allowlist、scheduler 函数名和 outbox 连接配置；先签名执行到期活动，再对 `mip-message-scheduler` 发起独立分域 reconcile HMAC，并仅在返回 `verified` 后成功退出。这样未来排期的 post-commit 崩溃窗口和 timer 重试耗尽都能重新布置最近唤醒时间。每次运行也会受控唤醒 outbox；人工复核、终止失败、提交结果待对账、outbox 唤醒失败或 scheduler reconcile 未确认都会返回非零退出码。命令只输出数量与布置状态，不打印密钥；稳定 HMAC 不应手工轮换、打印或提交。

知识采集日计划使用独立的 `mip-knowledge-scheduler`、`mip-knowledge-ingestion-next` timer、`MIPKnowledgeSchedulerRole` 和 `MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET`，不得与消息 scheduler 共用角色或密钥。该函数不连接 MySQL，计划领取、失败计数、去重、内容保存和审核状态仍由 `mip-admin-api` 提交；没有有效计划时关闭固定 timer。启用自动采集前必须先完成管理函数的函数名/HMAC 注入，再依次运行 `cloud:knowledge-scheduler:role`、canary deploy、带精确 generation 的 verify/activate 和最终 verify。任一阶段若回读到额外 trigger、VPC、数据库环境变量、共享角色、可由客户端调用或 generation 不一致，应停止并保留现状，不通过控制台手工补写。

单场活动提醒使用独立的 `communications.publish` capability。管理端只提交活动、事件版本、幂等请求标识和是否尝试微信提醒；`mip-admin-api` 仅从当前 `REGISTERED` / `ATTENDED` 报名事实选择收件人，并从已发布活动生成标题、正文和模板字段。单次最多 500 位收件人，超限时整笔拒绝；每位收件人的运营消息、outbox、幂等结果和一条汇总审计在同一事务提交。站内提醒始终进入 outbox；微信提醒仅在模板已配置且参与者有可用授权时投递，缺少模板不会使站内提醒失败。

活动相册使用独立 `events.album.manage` capability，并按平台、分会或活动范围重新鉴权。运营端只提交活动、照片、审核结论、原因和 `expectedVersion`；批准时服务端重新校验照片仍引用 `READY` 的 `EVENT_ALBUM` 素材。只有待审照片可以批准或拒绝，成功事务追加审计；拒绝和参与者撤回都保留照片事实，不物理删除。

管理端单笔退款会在事务提交后立即调用 `mip-refund-worker`；活动取消单次最多立即提交 10 笔，其余退款仍以 `mip_refunds` 为耐久队列。provider 暂时不可用、进程中断或晚到支付产生自动退款时，运行 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。命令可重复执行，不接收金额，不打印订单或支付凭证；返回 `failed>0` 时退出码非零，修复配置或 provider 故障后重试。退款 worker 不安装高频定时器。

媒体孤儿清理只通过受控命令运行，不安装定时器：`pnpm media:cleanup -- --confirm-env=<EnvID> --confirm-media=mip-media-api --minimum-age-hours=24 --limit=10`。命令只领取超过最短保留时间且未被资料、活动、待审/已发布相册照片、机会、案例或有效签到海报引用的 `mip_media_assets`；领取时先在当前 AppID 内锁定素材并将其改为非公开的 `PENDING` 删除态，再在事务外删除严格匹配 MIP 对象范围的文件。对象删除失败、响应不明确或最终状态写入失败时都保留 `PENDING`，由后续清理重试，不能恢复为 `READY`；被拒绝或已撤回照片的素材在保留期后可以回收，但照片事实仍保留。返回 `failed>0` 时退出码非零，排查存储权限后再重试。

AI 草稿默认保留 72 小时，`MIP_AI_DRAFT_TTL_HOURS` 只允许 1–168。确认、过期或删除草稿后，AI 页面会重试清理私有语音文件；无人访问的草稿使用 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 手动分批清理，不安装定时器。命令使用已部署 AI HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，只返回状态与数量。领取、外部删除和最终状态更新分离；任何外部或数据库不确定结果都保留 `PENDING`，后续重试，只有云存储删除成功且仍持有相同租约时才标记 `DELETED`。发布前需按数据处理约定确认正式留存时长。

脚本产物不得写入 EnvID 或 OpenID。路由与渠道事实以 `src/app.json`、`config/runtime-pages.json`、`docs/mip/REQUIREMENTS.md` 为准；Figma 已映射的用户端页面再按 `docs/mip/FIGMA_MAP.md` 验收。
