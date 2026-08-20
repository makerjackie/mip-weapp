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
| 活动 | 提交报名答案 | 乐观锁、票码、取消收敛 |
| 社区 | 关注/屏蔽/举报入口 | 不通知被屏蔽者；举报不自动处罚 |
| 后台 | 展示 capability | RBAC |

改表必须追加 `database/mysql` 迁移。支付逻辑变更必须同步 ledger 测试。真机验证清单见 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md)。
