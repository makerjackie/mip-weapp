# 知识内容

热点与知识内容共用一套服务端内容目录。用户端只提交搜索、筛选、评论和购买意图；内容发布状态、可见正文、价格、支付结果、解锁权益和退款资格均由服务端决定。

## 内容目录

| 内容类型 | 用途 | 交付事实 |
| --- | --- | --- |
| `HOT_NEWS` | 热点新闻 | 正文 |
| `ARTICLE` | 玩家攻略等图文 | 正文 |
| `WEB` | 外部网页 | HTTPS 地址 |
| `VIDEO` | 外部视频 | HTTPS 地址 |
| `PRIVATE_CHANNEL` | 私密视频号 | `finderUserName` 与 `feedId` |
| `EXPERT_SHARE` | 行业专家分享 | 正文 |

分类、来源和内容均按 AppID 隔离。客户端列表只读取已发布内容；详情在同一事务内按 identity→ACTIVE user 顺序加锁，再判断会员权益或单内容权益。注销先提交时请求降级为匿名访问；未解锁时不返回正文、外链或视频号参数。

内容访问类型为：

- `FREE`：公开内容；
- `MEMBER`：仅当前有效玩家可读；
- `MEMBER_OR_PAID`：当前有效玩家或已取得单内容权益的用户可读。

## 采集与发布

运营端可配置人工来源、JSON Feed 和 RSS 来源。`MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS` 是逗号分隔的精确来源域名白名单，不接受通配符或 IP。请求前解析全部 A/AAAA，任一结果属于回环、私网、链路本地、CGNAT、组播、保留地址或 IPv4-mapped IPv6 时拒绝；连接使用已校验地址的固定 lookup，避免 DNS rebinding。请求不跟随重定向，超时 10 秒；响应按流解压并在解压后执行 2 MB 上限，单次最多导入 50 条。采集按来源外部 ID 与内容摘要去重，并保存运行、条目和来源审计。

采集只允许运营人员显式触发，不安装定时器。导入内容进入待审流程，不能自动发布；私密视频号等无法从通用 Feed 安全交付的内容必须人工配置。内容发布流程为草稿、待审核、已发布、已拒绝和已撤回。正文按微信内容安全接口限制分块并保留重叠区，全部分块通过后才记录 `PASSED`；任何分块拒绝或检查异常均不能发布。审核写操作在最终 MySQL 事务内重新锁定 ACTIVE 用户、角色绑定和 capability policy，撤权或注销提交后旧请求不能继续写入。

`WEB` 与 `VIDEO` 外链还必须属于 `MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS`。该值同时进入服务端发布门禁和小程序构建，必须与微信公众平台配置的业务域名逐项一致；只接受 HTTPS 默认端口、无凭证、无 fragment 的链接，并限制查询参数数量和长度。web-view 页面只接收内容 ID，再从服务端重新读取访问权益和外链，不接受客户端直接传 URL。

## 单内容付费

`mip_orders.order_type=CONTENT` 是单内容付费的唯一订单事实，`resource_id` 指向知识内容。商品目录区分 `TEST` 与 `LIVE`，价格、币种、解锁期限和退款策略由服务端商品及下单时的不可变快照决定。测试目录默认价格由 `MIP_KNOWLEDGE_TEST_PRICE_CENTS` 配置，仓库默认 `990` 分；正式值可替换，不能由客户端覆盖。

只有 payment ledger 确认订单为 `PAID` 后才能创建 `mip_knowledge_entitlements`。页面调起支付成功不是解锁事实；`MIP_PAYMENT_MODE=disabled` 时购买入口明确关闭，不能模拟成功。

默认退款策略为 `BEFORE_ACCESS`：仅在商品快照规定的窗口内、内容尚未首次访问且申请剩余全额退款时允许。首次返回受保护正文时由服务端记录 `first_accessed_at`；全额退款确认后 ledger 撤销权益。`NON_REFUNDABLE` 商品不能退款。

## 评论与审核

内容评论使用通用 `mip_content_comment_settings`、`mip_content_comments` 和 `mip_content_comment_reports` 合同，目标类型支持知识、活动和机会；当前用户端知识页面接入该合同，机会域保留既有评论实现。创建、删除和举报要求完整身份门禁、幂等键、内容安全与版本校验；列表只返回可见的 opaque 档案引用，并应用双向屏蔽。

运营端通过 `knowledge.manage` capability 配置来源、分类、内容、商品和评论开关，审核内容、评论与举报，并查看采集运行记录。评论与举报 mutation 必须锁定并验证 `target_type=KNOWLEDGE`，活动和机会目标不能复用知识 capability。所有管理 action 先通过统一的协议、手机号、资料和角色门禁，并在最终写事务内再次校验。

热点发布每页选择 50 名已开启通知且仍为 ACTIVE 的用户，并以最多 5 个并发受控写入站内消息。超过一页时，outbox 先写入带稳定游标和确定性 ID 的 continuation 事件，再完成当前事件；受控 drain 会继续领取后续事件，重试依靠消息 dedupe key 和 continuation 主键保持幂等，直至所有符合条件的用户处理完成。

## 外部验收

本地代码和迁移不能替代以下证据：

- 迁移 `036_mip_knowledge_content.sql` 在目标 CloudBase/MySQL 应用并完成隔离、权限和健康检查；
- 正式信息源、行业分类、内容、价格、退款窗口和视频号参数配置；
- 微信开发者工具中的列表、筛选、搜索、详情、评论和后台工作流；
- 真机视频号打开、业务域名 web-view、正式商户支付、回调、查单和退款。
