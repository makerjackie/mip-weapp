# Membership domain

用户端与运营端共享同一套服务端事实。客户端不能决定：

- 价格与会员时长
- 报名资格与库存
- 支付是否成功
- 公开资料可见性
- 管理员角色

## 边界

| 域 | 客户端 | 服务端 |
| --- | --- | --- |
| 身份 | 触发手机号授权 | `FROM_OPENID \|\| OPENID`、换票 |
| 会员 | 选择 planId | 方案目录、权益重算 |
| 活动 | 提交报名答案、相册素材引用与撤回意图 | 乐观锁、票码、取消收敛、参与资格和相册发布状态 |
| 社区 | 关注/屏蔽/举报入口 | 不通知被屏蔽者；举报不自动处罚 |
| 后台 | 展示 capability | RBAC |

新建会员购买订单和调用管理 API 前，服务端必须按当前 AppID 重新确认用户为 `ACTIVE`，已接受当前版本协议，已绑定手机号，且资料已包含昵称和主分会。管理角色和 capability 在这些事实之后校验。已有订单查询、同一幂等购买请求恢复和退款恢复不因协议换版或资料状态变化被阻断，但仍必须通过可信微信身份和 AppID 校验订单归属。

改表必须追加 `database/mysql` 迁移。支付逻辑变更必须同步 ledger 测试。真机验证清单见 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md)。

举报、屏蔽、公开列表过滤和解除屏蔽合同见 [COMMUNITY_SAFETY.md](COMMUNITY_SAFETY.md)。

账号注销的未结交易阻塞、撤销与保留表清单、身份墓碑和不可逆 rollback 边界见 [ACCOUNT_CLOSURE.md](ACCOUNT_CLOSURE.md)。

活动相册只接受当前活动 `REGISTERED` / `ATTENDED` 参与者提交。客户端先压缩图片，但 `mip-media-api` 仍负责完整解码、重编码和图片内容安全；`mip-events-api` 再按 AppID、owner、`READY` 和 `EVENT_ALBUM` purpose 复核素材，并根据活动的 `AUTO` / `REVIEW` 配置决定发布或待审。本人撤回与运营审核均使用版本校验并保留事实和审计，不物理删除照片记录。
