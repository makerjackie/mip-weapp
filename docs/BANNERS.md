# Banner 管理

Banner 领域实现后台 PRD 的 BN-01 与 AC-07。服务端事实为 `mip_banners`，API 为 `mip-banners-api`，管理能力为 `banners.manage`。

## 状态和操作

- 新增记录默认 `INACTIVE`，避免未确认内容直接公开。
- 平台负责人和平台运营可以查看、新增、编辑、上移、下移、启用、停用和软删除。
- 每次编辑、排序、启停和删除都携带 `expectedVersion`；冲突时页面刷新服务端事实。
- 保存和启用前重新校验当前管理权限，并对公开名称与图片说明执行微信文本内容安全检查。
- 删除只写 `DELETED` 与 `deleted_at`，不物理删除 Banner、素材或审计记录。
- 公开读取只返回 `ACTIVE`，并按 `sort_order, id` 稳定排序。

## 素材合同

Banner 只接受当前操作者拥有的 `mip_media_assets`，或当前 Banner 已经绑定的原素材。保存和启用均由服务端验证：

- `status=READY`
- `purpose=BANNER`
- PNG 或 JPEG
- 宽度至少 750px，高度至少 300px
- 宽高比 1.8–3.2

上传仍由 `mip-media-api` 完整解码、重新编码、内容安全检查并写入 `mip/` 对象范围。上传成功不代表 Banner 已启用。

## 跳转合同

- 小程序页面必须是 `cloudfunctions/mip-banners-api/domain/validation.js` 中固定 allowlist 的绝对路径；带业务主键的详情页只接受规定参数和 UUID。
- 文章只接受 `https://mp.weixin.qq.com/s...`，拒绝凭证、端口、片段和其他域名。
- 服务端保存和启用时都会验证；公开读取还会过滤历史无效记录。

## 隔离和权限

- 只读写 `mip_banners`、`mip_media_assets`、`mip_users`、`mip_user_identities`、`mip_admin_role_bindings` 和 `mip_audit_logs`。
- `banners.manage` 只映射平台范围的 `PLATFORM_OWNER` 与 `PLATFORM_OPERATIONS`，城市和活动角色不能维护全平台 Banner。
- 运行时账号需要精确表级权限：`mip_banners` 为 `SELECT/INSERT/UPDATE`；身份、角色和素材表为 `SELECT`；审计表为 `INSERT`。不需要 `DELETE` 或 schema 级权限。

## 验收

本地聚焦测试覆盖跳转 allowlist、素材 owner/状态/用途/尺寸校验、公开过滤、版本冲突、排序、启停、软删除和审计。路由、部署清单、媒体 `BANNER` purpose 与首页/活动页消费接入完成后，再执行 `pnpm verify` 和开发者工具运行时验收。
