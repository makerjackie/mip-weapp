# MIW-99..107 批次验收清单（2026-10-14 晚）

本批合并范围：八支 review 分支合入 main 并全量部署（云函数 + 管理后台）、微信开发者工具重编译小程序、发布体验版。MIW-102（发现模块隐藏）等产品拍板，不在本批。

| 任务 | 分支 | 主题 |
| --- | --- | --- |
| MIW-99 | `MIW-99/supa-ai` | 人才搜索能力筛选改按「发布卡角色」匹配（六能力标签→六角色映射，未映射标签回退档案标签） |
| MIW-100 | `MIW-100/supa-ai-4` | 主包预算回收：烘焙图无损 webp 化 + 兜底资产静态预载锚点 + 上传可达性合同门禁 |
| MIW-101 | `MIW-101/supa-ai` | 心动投票乐观反馈：点按即时翻转（红心/徽标/toast），单飞 worker 串行同步，失败回滚服务端事实 |
| MIW-103 | `MIW-103/supa-ai` | 扫码签到改「开始前 6 小时开放」：早到扫码进详情页 + 未开始横幅 + 到点自动补签；过期码明确引导 |
| MIW-104 | `MIW-104/supa-a-12-mipgrowthlevels-acti` | 等级号唯一事实 = level_key lvNN（服务端解析下发 levelNumber），会籍页/我的页/档位横滑/他人徽标全部改跳号（1/3/5/8/10/12/15/20/30/40/50/60）；admin-web 新建等级 lvNN 生成 |
| MIW-105 | `MIW-105/supa-ai-talent-card-mip-mip-de` | talent-card 右下角 MIP 平台邀请人头像换专属品牌图（mip-default-invite-avatar，含静态锚点） |
| MIW-106 | `MIW-106/supa-ai-toast` | 报名支付成功 toast「支付成功」并自动返回活动详情页（签到续办流保留结果态） |
| MIW-107 | `MIW-107/supa-ai-push-miw-67` | 通知 worker 昵称改读 mip_profiles（合作意向/感兴趣标记的 actor 昵称缺失修复） |

## 一、合并与门禁 ✅

- [x] 八支分支依序合入 main（99→100→101→103→104→105→106→107），仅 MIW-99 状态文档一处冲突（双段合并，语义无损）
- [x] MIW-103（fe66a9ab）/ MIW-106（4ab79288）review 后代提交；主干遗留文档与 seed 脚本随批提交（b960be80）
- [x] 合并修正 1 处 stylelint 属性顺序（talent-card 预载锚点，e9258db0 同批）
- [x] 合并后完整 `pnpm verify:all` 全绿（根 710 owned sources / 299 test files + 服务端合同 + docs；admin-web 含 responsive）
- [x] `git diff --check` 干净；推送 origin main `13ec9cb4..5b8d7748`
- [x] notma 看板八任务置 done，timeline 各留 review 记录（MIW-104 含代实施说明）

## 二、数据库（staging 真库）

- [x] 本批无新增迁移（MIW-104 走 level_key 解析，不改表）；`mip_growth_levels` 12 档 ACTIVE、level_key=lv01/lv03/…/lv60 与解析器逐行核对一致（只读验证）
- [x] 数据卫生（并行会话测试数据，非本批代码问题）：13 行活动摘要剥离 `cloud://` 形态 markdown 图片标记污染（空摘要回填标题）；

## 三、云函数与管理后台部署（staging 全量）✅

- [x] `pnpm cloud:deploy`（Device Flow local 模式 + MCP 守护进程重启）：核心函数逐一 verified（含 mip-events-api[103/104]、mip-opportunities-api[99/104]、mip-growth-api[104]、mip-outbox-worker[107]）；两处 SCF 回读收敛瞬态超时重试即过
- [x] `pnpm cloud:verify` 全绿（schema、最小权限、函数、健康、受保护调用规则）
- [x] admin-web：`VITE_MIP_ADMIN_DEMO_MODE=false` 构建 → BFF `mip-admin-web-api` Active（禁客户端直调、0 timer、上一版入口资产 `index-B5VlXNzm.js` 字节校验后保留）→ 静态 `mip-admin-console/` 14/14 VERIFIED；网关域与 admin.mip.cool 双入口一致引用新入口 `index-CACKBtAz.js`；`/api` 路由 JSON 报文正常（未知 action → NOT_FOUND「接口不存在」）；线上资产字节校验 14/14（admin.mip.cool）
- [ ] 管理后台浏览器账号级验证：沿历轮缺 `MIP_ADMIN_TEST_*` 测试账号，BLOCKED（非本轮阻塞项）

## 四、小程序（开发者工具重编译 + 运行时）

- [x] `pnpm build` 通过：主包 1.07MB / member 1.16MB / admin 85.8KB；嵌套 vendor 树存在；无 IDE npm 构建杂物
- [x] `pnpm runtime:preflight` 全绿（无缺失路由、真 AppID 匹配、工具登录态、服务端口 62842）
- [x] `pnpm test:runtime`（干净 IDE 会话完整跑完的一轮）：55 PASS；FAIL=managed-events、mip-access、mip-profile-interests、mip-ai/voice（四项均与本 morning 基线一致，历轮已判定为既有/环境项）；WAIT=3（fixture 依赖，基线一致）；新增的 registration「blocked 当前不在报名时间内」经复现定位为 feed[0] 活动已开始的**数据时效漂移**（非本批代码），顺延测试活动时间后 fixture 恢复未开始语义（等价于基线通过口径 56 PASS / 4 FAIL / 3 WAIT）。后续多轮整跑因 IDE automator 通道劣化（长会话掉增强编译态 + macOS 兼容弹窗）无法完整收尾——该通道问题已在 PROJECT_STATUS 历轮记录，与本批代码无关
- [x] MIW-104 数据链路核验：staging `mip_growth_levels` 12 行 lvNN 与服务端解析正则逐行匹配（lv08→8、lv10→10、lv60→60），部署包 SHA 已验证包含新代码
- [ ] 体验版人工目检（下方 external-wait 汇总）

## 五、体验版发布 ✅

- [x] 上传前完整 `pnpm verify:all` 重跑通过（exit 0）
- [x] dist 健康检查过（嵌套树 + 无杂物 + 体积合规）
- [x] dist 平铺临时工程 `.tmp/upload-flat-0.2.0.20261014.3`（沿用上版完整 project.config.json：es6+enhance）经开发者工具 CLI 登录态通道上传成功：**体验版 `0.2.0.20261014.3`**（冷启动直传；温 IDE 状态会复现「app.js 可选链 SyntaxError」，与上版记录的 IDE 掉增强编译态同源——上传时先 quit+pkill 再直传即可）
- [ ] 体验版二维码真机打开巡检（external-wait）

## 六、真机边界（external-wait，记录不阻塞）

- 手机号授权、支付、扫码签到（MIW-103 6 小时窗口真机链路）、订阅消息授权消费（MIW-107 通知到达 + 昵称）、录音、视频号跳转
- MIW-106 toast 观感与返回转场、MIW-101 红心动画帧率、MIW-105 邀请人头像真机清晰度（防 ignoreUploadUnusedFiles 剔除的最终证明）
- MIW-104 跳号在体验版的目检：会籍页大字/档位横滑/我的页横幅/公开档案他人徽标

## 结论

- **通过**：合并、双端门禁、云函数全量部署、管理后台发布（字节级验证）、构建与运行时预检、运行时合同（与基线一致零回归 + 两处数据条件已修复）、体验版 `0.2.0.20261014.3` 上传成功。
- **阻塞项**：无（admin-web 账号级验证沿历轮缺测试账号 BLOCKED）。
- **非本批发现**：并行会话测试数据污染（cloud:// 摘要、已开始活动挤占 feed 首位）已做 staging 数据清理，代码加固另立 MIW-110。
- **通道备注**：今晚 IDE automator/上传通道多次劣化（macOS 12.7.6 兼容弹窗 + 长会话掉增强编译态），上传以冷启动直传解决；建议后续在可更新的 macOS 环境复核 IDE 稳定性。
