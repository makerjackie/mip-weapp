# mip-community-api

提供公开公告读取，以及完成身份资料后的屏蔽、解除屏蔽和举报能力。公告读取不要求用户资料或手机号，所有写操作仍从 CloudBase 上下文重建 AppID 和用户身份。

MIP 用户侧社区安全服务。仅接受 AppID 绑定的 `profileRef`，负责屏蔽、解除屏蔽、个人屏蔽列表和举报事实；不发送站内或微信通知。

所有身份、目标用户和归属都由可信 CloudBase 上下文及 `mip_*` MySQL 表重建。客户端不能提交用户 ID、OpenID 或举报状态。
