# 活动超售发布与验收记录（2026-10-12）

发布提交 `c2859198`（feature/admin-form-ux），Plan：[oversell-registration/plan.md](../../../plans/oversell-registration/plan.md)（accepted）。

## 已完成（部署）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| DB 迁移 107（mip_events.oversell_enabled + 互斥 CHECK） | 已应用到 staging（此前在 106，仅应用本条）；`applied: mip_events_oversell_enabled` + `isolated schema verified` | 迁移脚本输出；备份 manifest `/Users/oudouglas/Backups/mip-weapp/2026-10-12T120929-334Z/`（154 表 4944 行，仓库外） |
| 云函数 mip-events-api / mip-admin-api / mip-outbox-worker | 逐个部署，`verified`（健康检查含 CloudBase MySQL 持久化证明） | 部署脚本输出；首轮 API Key STS 被拒（`Cam authentication failed`），改用本机既有 Device Flow 授权 + `CLOUDBASE_AUTH_MODE=local` 后通过 |
| admin-web BFF（mip-admin-web-api） | 重新构建部署（内置 public/assets 随新前端更新），Active、0 timer | 部署输出 JSON（privateTarget 本机） |
| admin-web 静态（mip-admin-console/） | 14 文件上传并 VERIFIED | `.tmp/admin-cloudbase-static` |
| 公开 HTTPS 资产 | 14/14 与本次构建一致，入口 `index-B2CiC1pU.js`（新哈希=线上已是本次版本） | `.tmp/admin-release-oversell-20261012/assets.public.json` |

## 验收进度（Plan Proof 四场景）

- 逻辑级：decideRegistration 超售/候补优先/PAID 拒绝/互斥，`rules.test.js` 11/11；admin-api 校验（FREE 可存、互斥拒、PAID 拒）18/18；admin-web 契约（映射/人话报错/联动防呆）21/21。**全部通过。**
- 环境级：函数健康 + schema 列回读 ✓（部署验证含持久化证明）。
- **BLOCKED ①**：真实 HTTPS 认证+读模块校验（`verify-admin-cloudbase.mjs`）——缺配置的验证账号（`MIP_ADMIN_TEST_PHONE/PASSWORD` 不在本机 env），历史发布同样未入库该凭证。
- **BLOCKED ②**：真机报名四场景（超售 3 人全成功/候补不变/拒绝不变/存量候补切策略不受影响）——需真实微信成员身份，须迁移部署后在小程序真机执行。

## 需要提供

1. 后台密码登录测试账号（手机号+密码），用于脚本化真实登录验收与浏览器视口验收；
2. 真机报名由持微信的用户按上述四场景操作（或提供可驱动成员报名的既定测试通道）。
