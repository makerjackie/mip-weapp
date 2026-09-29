# W00 接手基线

2026-09-29，用户切换执行模型并授权按完整计划实施。源码 HEAD：`439abe48a4e0abf7496b803fd2bde8decd6c2ee6`；Node 22.23.1、pnpm 11.14.0。接手时工程门禁已有同日通过记录，业务源码尚未变化，无须重复基线测试。

接手前的 dirty diff 已在本机保存，SHA-256：`1b9d200207cc12ad1a9a9ceafff87a0c374529d40800b94e1424b89b149d2cfe`。既有登录/BFF/临时域名代码及标准/来源/审查文档保持原有归属，后续不 reset、stash 或整仓覆盖。

非空合同样例从现有服务端 repository 的序列化出口生成：机会以 `createAdminPrdExtensions().getOpportunityDetail` 为首个样例，覆盖平铺 DTO、商业条件、多城市、角色和版本。React 测试走同一 module mapper 和真实表单提交 interface。测试对象为合成值，不向生产写样例、发消息或退款。

Q-ADMIN-01～09 仍按需求基线管理；先实施不依赖业务变化的修复。下一步 W01：机会回填和冲突草稿保护。
