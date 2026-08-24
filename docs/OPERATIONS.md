# Operations

运营工作台是任务入口，不是报表大屏。入口：`packages/admin/dashboard`，服务端入口为 `mip-admin-api`；未来独立后台复用同一 DTO、capability 和审计合同。

## 初始化命令

```bash
pnpm database:setup -- \
  --confirm-env=<EnvID> \
  --confirm-prefix=mip_ \
  --backup-manifest=/absolute/path/to/manifest.json

pnpm project:init
pnpm database:grants -- \
  --confirm-env=<EnvID> \
  --confirm-runtime-user=<exact-runtime-user>

pnpm cloud:deploy-payment -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-cloudpay \
  --confirm-callback=mip-cloudpay-callback \
  --confirm-refund=mip-refund-worker

pnpm admin:bootstrap -- --confirm-env=<EnvID> --confirm-owner
pnpm seed:demo -- --confirm-env=<EnvID> --confirm-demo
```

支付模式为 `live` 时，支付部署命令还必须追加 `--confirm-live`。demo seed 只允许用于 development/test 环境；owner 候选不唯一时，bootstrap 命令追加 `--user-id=<用户 UUID>`。

活动创建/编辑、状态变更和撤销签到只通过 `mip-admin-api` 执行。`mip-events-api` 不接受这些管理写操作，避免同一活动事实存在第二套状态机、退款和权限路径。

- 分会：平台范围、城市分会、主分会和分会成员归属
- 活动：统一列表 → 单场管理 → 编辑/名单/相册/导出/团队；可将任意授权活动复制为独立草稿，活动时间按周顺延，报名、订单、签到、相册和消息不会复制
- 订单：`mip_orders` 统一展示会员和付费活动订单；退款由 ledger 状态决定
- 退款：服务端角色校验；管理端只提交订单/退款意图，金额和权益由 ledger 决定；到账后由 ledger 重算权益，不能手工改玩家状态
- 名册导出：含手机号的导出走安全票据，页面只显示掩码票码
- 公告：使用独立 `announcements.manage` capability；平台运营维护全平台和分会公告，城市管理员只能维护本分会公告
- 任务：使用独立 `tasks.manage` capability；平台负责人和平台运营配置全员或指定成员任务、截止时间和单个模板，按当前 AppID 成员范围搜索并批量派发或软撤销，发布、下架和软删除任务，并查看或导出完成流水
- 勋章：使用独立 `badges.manage` capability；维护目录、排序与启停，授予或撤销玩家勋章并保留审计。仍在佩戴的获授事实先取消佩戴，再撤销，不物理删除历史
- 游戏化：使用独立 `game.manage` capability；平台负责人和平台运营维护赛季、队伍、有效会员成员、每周对阵、服务端结算和排行快照。管理端不输入比赛分数，结算和团队/个人排行只从当前 AppID 的成长流水与账户事实生成
- 举报：使用固定类别和可选短说明；审核使用独立 `community.reports.manage` capability、版本冲突保护和逐笔原因，无批量封禁
- owner 引导：使用上方带环境和 owner 确认参数的命令，拒绝 demo 身份；手机号、导出、退款、角色变更和签到覆盖必须使用对应 capability

现场人员只拥有本场活动的只读名册与签到权限，不授予手机号原文、报名审核、导出或消息发布能力。需要联系参与者时由活动负责人或管理员在明确用途下使用独立 `users.phone.read` capability。

游戏化只向当前有效会员开放。赛季结束、周赛结算和排行生成都写入不可变或版本化快照，后续成长值变化不回写历史结果。游戏币使用服务端权威账户与不可变流水，发放、消费和盲盒核销不得由客户端提交金额或结果。正式 PK 规则、等级阈值和队伍大本营视觉尚未提供时使用仓库内可替换的中性默认配置，不能把默认配置描述为正式赛事规则。

签到确认使用 `events.checkin.manage`；撤销误签到使用更窄的 `events.checkin.undo`，只授予活动负责人、活动管理员、城市管理员和平台运营，不授予现场人员。撤销必须提交 1–120 字原因、当前报名版本并追加审计；签到和撤销均追加 transition/outbox，撤销只冲销本轮签到实际入账的成长值，重试与乱序不重复入账。报名恢复为 `REGISTERED`，不删除到场记录。

机会草稿归档使用 `opportunities.archive`，只授予平台负责人和平台运营。归档必须提交当前版本和原因；存在引荐、兴趣、订单、公告或 outbox 事实时拒绝归档。详见 [机会草稿归档](OPPORTUNITY_ARCHIVE.md)。

城市分会目录仅允许拥有平台范围 `branches.manage` capability 的账号维护。分会标识创建后不可修改，名称、城市和简介由服务端规范化，编辑和启停使用版本校验并追加审计。停用前服务端会锁定分会并检查启用成员、城市管理员、已发布活动和已发布机会；任一计数不为零时整笔拒绝，不物理删除分会，也不由客户端推断是否可以停用。

用户、活动参与者、活动订单、全部订单和成长流水导出由服务端重新查询当前事实，生成私有 `mip/exports/<appScope>/` XLSX。票据绑定 AppID、请求人、权限范围和一次性令牌；含手机号文件还会重新校验 `users.phone.read`。小程序在短租约内下载文件，下载成功后消费票据并尝试删除云文件；不向客户端返回对象 key 或 `cloud://` fileID。默认上限是 5000 行和 8 MiB，可在部署时用 `MIP_EXPORT_MAX_ROWS` 与 `MIP_EXPORT_MAX_BYTES` 在受控范围内调整。

用户举报由 `mip-community-api` 只追加到 `mip_reports`，相同用户和 `requestId` 只生成一条事实；网络重试必须复用同一请求标识。提交举报不产生目标用户消息，也不自动封禁。运营审核仅向 `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS` 授予平台范围 `community.reports.manage`，通过 `expectedVersion`、1–300 字原因和追加审计迁移 `PENDING → REVIEWING → RESOLVED | DISMISSED` 状态。列表只返回遵守公开可见性的资料摘要，不返回手机号、OpenID 或内部用户 ID；审核结果不自动封禁或隐藏用户。用户屏蔽写入 `mip_user_blocks`，解除屏蔽保留版本和时间，不物理删除关系。

公告管理向 `PLATFORM_OWNER`、`PLATFORM_OPERATIONS` 和 `BRANCH_ADMIN` 授予独立 `announcements.manage` capability。平台角色可维护全部范围，城市管理员只能维护自身分会；服务端同时校验编辑前范围与提交后的新范围，禁止借编辑跨范围移动。保存草稿执行内容安全检查，发布、撤回、置顶和编辑均校验版本并追加审计。公告不物理删除，公开端只读取已发布且位于展示窗口内的内容；详情关联只允许同 AppID 的活动或机会。

通知和 outbox worker 默认不安装定时器。业务函数在同一事务写 outbox；运营可用 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10` 受控恢复积压。异常中心读取 `mip_outbox_events`、支付/退款、媒体、消息投递和 AI 草稿状态，不通过页面菜单越权修改事实，完整权限和脱敏合同见 [异常中心](OPERATIONAL_EXCEPTIONS.md)。旧 `membership-*` 运营函数不再部署。

单场活动提醒使用独立的 `communications.publish` capability。管理端只提交活动、事件版本、幂等请求标识和是否尝试微信提醒；`mip-admin-api` 仅从当前 `REGISTERED` / `ATTENDED` 报名事实选择收件人，并从已发布活动生成标题、正文和模板字段。单次最多 500 位收件人，超限时整笔拒绝；每位收件人的运营消息、outbox、幂等结果和一条汇总审计在同一事务提交。站内提醒始终进入 outbox；微信提醒仅在模板已配置且参与者有可用授权时投递，缺少模板不会使站内提醒失败。

活动相册使用独立 `events.album.manage` capability，并按平台、分会或活动范围重新鉴权。运营端只提交活动、照片、审核结论、原因和 `expectedVersion`；批准时服务端重新校验照片仍引用 `READY` 的 `EVENT_ALBUM` 素材。只有待审照片可以批准或拒绝，成功事务追加审计；拒绝和参与者撤回都保留照片事实，不物理删除。

管理端单笔退款会在事务提交后立即调用 `mip-refund-worker`；活动取消单次最多立即提交 10 笔，其余退款仍以 `mip_refunds` 为耐久队列。provider 暂时不可用、进程中断或晚到支付产生自动退款时，运行 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。命令可重复执行，不接收金额，不打印订单或支付凭证；返回 `failed>0` 时退出码非零，修复配置或 provider 故障后重试。退款 worker 不安装高频定时器。

媒体孤儿清理只通过受控命令运行，不安装定时器：`pnpm media:cleanup -- --confirm-env=<EnvID> --confirm-media=mip-media-api --minimum-age-hours=24 --limit=10`。命令只领取超过最短保留时间且未被资料、活动、待审/已发布相册照片、机会、案例或有效签到海报引用的 `mip_media_assets`；领取时先在当前 AppID 内锁定素材并将其改为非公开的 `PENDING` 删除态，再在事务外删除严格匹配 MIP 对象范围的文件。对象删除失败、响应不明确或最终状态写入失败时都保留 `PENDING`，由后续清理重试，不能恢复为 `READY`；被拒绝或已撤回照片的素材在保留期后可以回收，但照片事实仍保留。返回 `failed>0` 时退出码非零，排查存储权限后再重试。

AI 草稿默认保留 72 小时，`MIP_AI_DRAFT_TTL_HOURS` 只允许 1–168。确认、过期或删除草稿后，AI 页面会重试清理私有语音文件；无人访问的草稿使用 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 手动分批清理，不安装定时器。命令使用已部署 AI HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，只返回状态与数量。领取、外部删除和最终状态更新分离；任何外部或数据库不确定结果都保留 `PENDING`，后续重试，只有云存储删除成功且仍持有相同租约时才标记 `DELETED`。发布前需按数据处理约定确认正式留存时长。

脚本产物不得写入 EnvID 或 OpenID。完整活动操作说明可参考仍保留的页面规格 `page-specs.md`。
