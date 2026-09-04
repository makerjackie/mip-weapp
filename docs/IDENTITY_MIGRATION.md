# AppID 身份迁移

短期开发可以使用 OIMVP AppID，但正式 MIP AppID 上线前必须迁移到新的 CloudBase/MySQL 环境。OpenID 绑定单个小程序，不能直接作为新 AppID 的用户标识。

当前 schema 的多张业务表使用全局 UUID 主键，并以 `(app_id, id)` 外键关联且不允许级联更新。因此，不能在同一个 MySQL schema 中保留旧 AppID 数据的同时，用相同主键复制一份新 AppID 数据，也不能直接批量改 `app_id`。正式切换只支持“冻结源环境 → 复制到空的新环境 → 在导入过程中映射 AppID → 校验后启用”。如果未来必须让两个 AppID 在同一数据库长期并存，需要先设计全量 ID 重映射和引用映射工具；当前仓库没有提供该能力。

## 自动衔接条件

只有同时满足以下条件时，系统才允许自动衔接原用户：

- 新旧小程序绑定到同一微信开放平台，可信云函数上下文能够提供同一 UnionID；
- 源环境已使用稳定的 `MIP_UNION_IDENTITY_PEPPER` 采集 UnionID 摘要；
- 迁移到空的新环境时保留 MIP `user_id`、所有业务外键和 `union_identity_key`，并在导入数据中把应用范围映射为正式 AppID；
- 目标环境配置与源环境完全相同的 `MIP_UNION_IDENTITY_PEPPER`；
- 仅在完成迁移核对后设置 `MIP_UNION_ID_REBIND_ENABLED=true`。

## 无 UnionID 时

本仓库不提供按手机号自动认领或合并历史账号的运行时通道。没有可校验 `union_identity_key` 的数据，必须在
冻结写入后通过受审计的离线映射完成身份核对，再导入空的新环境；无法建立可信映射的账号不迁移。手机号
只能用于当前账号的服务端验证与绑定，已被其他账号占用时返回冲突，不在登录过程中改写用户主键或业务外键。

数据库只保存 HMAC 摘要，不保存 OpenID 或 UnionID 原文。`mip_user_identities` 在一个 AppID 范围内要求 UnionID 摘要唯一；摘要冲突时拒绝登录衔接，不自动合并用户。

首次部署前运行 `pnpm secrets:init -- --confirm-env=<EnvID>`。命令会先读取目标环境中已有的 `mip-*` 函数配置：已有值与本地值不一致时失败关闭；没有已部署值时才生成稳定密钥。明文只写入被 Git 忽略且权限为 `0600` 的 `.env.secrets.local`，终端和 `.tmp/mip-secret-inventory.json` 只记录来源与短指纹。迁移到正式 AppID 或新环境时必须安全复制同一份 `MIP_UNION_IDENTITY_PEPPER`，不得重新生成。

## 必须转换的数据

- 手机号 ciphertext 的 AES-GCM AAD 包含源 `app_id` 和 `user_id`。迁移工具必须持有源密钥，以源 AAD 解密，再用目标 AppID、同一用户 ID 和目标密钥重新加密；逐条验证后才能导入。只改数据库 `app_id` 会使手机号永久不可读。
- 微信订阅授权绑定旧 AppID 下的 OpenID，密文和摘要也包含源 AppID。`mip_notification_grants` 不迁移，未完成的 `mip_delivery_tasks` 在源环境收敛或取消；用户在正式小程序内重新授权。站内消息事实可按业务保留，但不能复用旧外部投递凭据。
- 图片、AI 音频和导出对象 key 都包含 AppID 派生范围。需要把长期素材复制到用目标 AppID 重新派生的 `mip/` key，并同步校验后的 `object_key`、`cloud_file_id`；临时导出票据和导出对象不迁移。
- 旧邀请/签到 token、临时幂等 claim 和未完成支付/退款不能直接带到新 AppID。先完成或关闭结算，再在目标环境重新签发临时凭据。

密钥清单要区分用途：`MIP_UNION_IDENTITY_PEPPER` 必须保持一致以完成身份衔接；手机号、媒体和 AI 存储密钥可以轮换，但迁移工具必须同时取得源值和目标值完成重加密或重键；通知接收凭据不做转换。源密钥在迁移校验和回滚窗口结束前不得销毁。

## 切换步骤

1. 冻结写入窗口，取得新的稳定备份和校验清单。
2. 统计源 AppID 范围内用户数、已采集 UnionID 摘要数和重复摘要；存在重复时停止迁移。
3. 在空的新环境应用相同 migration lock；先执行手机号重加密、对象重键及临时凭据收敛，再按外键顺序复制经过转换的 `mip_*` 业务数据和长期 `mip/` 对象。保留主键与外键，并在导入数据中把可信 `app_id` 映射为正式 AppID。不得把映射后的副本写回当前共享 schema。
4. 在目标环境先以关闭状态部署，执行只读结构、行数和引用完整性检查。
5. 配置正式 AppID、相同的 UnionID pepper，再开启 rebind；用户首次进入时以 UnionID 摘要把新的 OpenID 摘要绑定到原用户。
6. 对已衔接、未衔接和冲突用户分别统计。达到业务确认的迁移截止条件后关闭自动 rebind，剩余账号进入人工核验。

如果新旧小程序不能取得同一 UnionID，不能自动复用身份。此时使用真机验证手机号或人工凭证建立一次性映射；不得仅按昵称、头像、公司或客户端提交的用户标识合并账号。

## 仓库迁移工具

当前仓库已经提供完整的 MIP AppID 范围迁移工具，禁止再用手工 SQL 改 `app_id`：

1. `scripts/export-mip-app-scope.mjs` 只读取 migration lock 中的 `mip_*` 表。业务表始终带精确源 AppID 条件；两张 schema ledger 仅用于结构证据，不进入目标业务导入。命令要求操作人先停止源 MIP 写入并显式确认，使用主键游标分页，导出后再次核对完整主键清单与行数；输出 JSONL、schema、UnionID/素材 inventory、SHA-256 和 manifest。私有包必须放在仓库外并保持 `0700/0600`。
2. `scripts/transform-mip-app-scope-export.mjs` 离线映射 AppID，保留业务 UUID 和外键；手机号及名片联系方式按源/目标 AAD 解密再加密。通知授权、投递任务、支付尝试/回调、幂等 claim、AI 草稿创建请求、会员邀请码、签到/活动邀请凭据、导出票据、outbox、Web BFF nonce 等环境绑定或可重建事实会被明确排除并计数。`mip_ai_drafts` 只保留 `CONFIRMED` 行，其他状态均按临时草稿丢弃；保留行的 `audio_asset_id` 会清空，不把临时 AI 音频带入目标环境。
3. `scripts/copy-mip-media-app-scope.mjs` 只复制通过完整文件集、checksum、manifest、源环境指纹和 inventory 校验的 `READY` 长期素材。对象按目标 staging scope 重键，逐个执行源下载、目标上传、目标回读、字节数和 SHA-256 校验，再更新转换包中的 `mip_media_assets`、media inventory、行数、manifest 和 checksum。临时导出、会员邀请码、二维码/海报、AI 音频以及未就绪或不支持的素材不迁移；对应媒体行会从转换包删除。删除前会扫描所有待导入表，任何仍引用这些媒体 ID 的行都会使流程明确失败，不生成带孤儿引用的导入包。
4. `scripts/import-mip-app-scope.mjs` 只接受同一 migration lock 的完整转换包。首次导入要求目标全部 MIP 业务表全局为空；外键始终开启，按依赖顺序插入并处理受控循环引用。私有 checkpoint 支持续跑，完成后验证全局行数、目标主键清单、源 AppID 残留和外键孤儿。

标准命令如下，真实环境和 AppID 只通过本机参数或私密 env 文件传入，不写进文档或 Git：

```bash
node scripts/export-mip-app-scope.mjs \
  --confirm-env=<source-env> \
  --source-app-id=<source-appid> \
  --confirm-source-writes-frozen

node scripts/transform-mip-app-scope-export.mjs \
  --input=<source-package> \
  --output=<target-package> \
  --source-app-id=<source-appid> \
  --target-app-id=<target-appid> \
  --source-env-file=<source-env-file> \
  --target-env-file=<target-env-file>

pnpm storage:copy:app-scope -- \
  --source-package=<source-package> \
  --transformed-package=<target-package> \
  --source-env-file=<source-env-file> \
  --target-env-file=<target-env-file> \
  --confirm-source-env=<source-env> \
  --confirm-target-env=<target-env> \
  --confirm-source-app-id=<source-appid> \
  --confirm-target-app-id=<target-appid>

pnpm database:import:app-scope -- \
  --input=<target-package> \
  --confirm-env=<target-env> \
  --confirm-prefix=mip_ \
  --source-app-id=<source-appid> \
  --target-app-id=<target-appid>
```

迁移演练和目标环境状态不在本运行手册中维护。执行后将来源环境、目标环境类型、迁移 lock、行数、素材校验、权限回读和验证时间记录到 `docs/mip/evidence/`，并在 [MIP 项目状态](mip/PROJECT_STATUS.md) 引用；不得用旧演练数字推断当前环境。
