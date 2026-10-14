# MIW-99..107 批次验收清单（2026-10-14 晚）

本批合并范围：八支 review 分支合入 main 并全量部署（云函数 + 管理后台）、微信开发者工具重编译小程序、发布体验版。MIW-102（发现模块隐藏）等产品拍板，不在本批。

| 任务 | 分支 | 主题 |
| --- | --- | --- |
| MIW-99 | `MIW-99/supa-ai` | 人才搜索能力筛选改按「发布卡角色」匹配（六能力标签→六角色映射，未映射标签回退档案标签） |
| MIW-100 | `MIW-100/supa-ai-4` | 主包预算回收：烘焙图无损 webp 化 + 兜底资产静态预载锚点 + 上传可达性合同门禁 |
| MIW-101 | `MIW-101/supa-ai` | 心动投票乐观反馈：点按即时翻转（红心/徽标/toast），单飞 worker 串行同步，失败回滚服务端事实 |
| MIW-103 | `MIW-103/supa-ai` | 扫码签到改「开始前 6 小时开放」：早到扫码进详情页 + 未开始横幅 + 到点自动补签；过期码明确引导 |
| MIW-104 | `MIW-104/supa-a-12-mipgrowthlevels-acti` | 等级号唯一事实 = level_key（服务端解析下发 levelNumber），会籍页/我的页/档位横滑/他人徽标全部改跳号（1/3/5/8/10/12/15/20/30/40/50/60） |
| MIW-105 | `MIW-105/supa-ai-talent-card-mip-mip-de` | talent-card 右下角 MIP 平台邀请人头像换专属品牌图（mip-default-invite-avatar，含静态锚点） |
| MIW-106 | `MIW-106/supa-ai-toast` | 报名支付成功 toast「支付成功」并自动返回活动详情页（签到续办流保留结果态） |
| MIW-107 | `MIW-107/supa-ai-push-miw-67` | 通知 worker 昵称改读 mip_profiles（合作意向/感兴趣标记的 actor 昵称缺失修复） |

## 一、合并与门禁

- [ ] 八支分支依序合入 main（99→100→101→103→104→105→106→107），冲突面（mip-growth wxml、talent-card 等）逐个消解并复核语义
- [ ] MIW-103（fe66a9ab）/ MIW-106（4ab79288）/ 主干遗留文档（b960be80）已代提交
- [ ] 合并后完整 `pnpm verify:all` 全绿（小程序 + CloudBase + admin-web）
- [ ] `git diff --check` 干净；推送 origin main 成功
- [ ] notma 看板八任务置 done，timeline 留 review 记录

## 二、数据库（staging 真库）

- [ ] 本批无新增迁移（MIW-104 走 level_key 解析，不改表）；`mip_growth_levels` 12 档 ACTIVE、level_key=lv01/lv03/…/lv60 数据核对（只读）

## 三、云函数与管理后台部署（staging 全量）

- [ ] `pnpm cloud:deploy --confirm-env + --confirm-runtime-user` 核心函数部署 verified（重点：mip-events-api[MIW-103/104]、mip-opportunities-api[MIW-99/104]、mip-growth-api[MIW-104]、mip-outbox-worker[MIW-107]）
- [ ] `pnpm cloud:verify` 全绿
- [ ] admin-web BFF（`mip-admin-web-api`）+ 静态 `mip-admin-console/` 发布；入口 HTML 引用新构建哈希
- [ ] 管理后台真实登录 + 受影响页面巡检（等级配置、活动签到码、机会列表）

## 四、小程序（开发者工具重编译 + 运行时）

### MIW-104 等级跳号（最高风险，先行验证）

- [ ] 会籍页当前等级大字 = 跳号（如第 2 档显示 Lv.3，非 Lv.2）；档位横滑标签 Lv.1/3/5/8/10/12/15/20/30/40/50/60
- [ ] 我的页等级横幅 Lv.N 跳号一致；权益弹层标题跳号一致
- [ ] 公开档案/心动/名片/参与人/合作人列表的他人 Lv 徽标跳号一致（服务端下发）
- [ ] 解析失败兜底：无 level_key/非 lv 前缀的等级回退位置序数，页面不炸

### MIW-103 签到 6 小时窗口

- [ ] 早于开始 6 小时扫静态海报码：正常进详情页，信息卡下「活动未开始，XX:XX 起可现场扫码签到（开始前 6 小时开放）」横幅
- [ ] 到达开放点后回到详情页：自动补签成功
- [ ] 现场轮换码过期：提示「向工作人员获取最新活动码」
- [ ] 签到意图超 30 分钟：提示重扫原码（不误导换码）
- [ ] [真机] 扫码签到链路整体复验（external-wait）

### MIW-101 心动乐观反馈

- [ ] 点红心：卡片红心即时变色弹跳、徽标 +1、toast「已心动」即时出现（不等网络）
- [ ] 连续换投 A→B：红心跟手、徽标不闪跳（恒 1）
- [ ] 断网/失败场景：无排队意图时回滚红心并提示；恢复后状态与服务端一致
- [ ] 四 tab（嘉宾/玩家/我的心动/对我心动）切换时红心徽标稳定

### MIW-106 支付成功反馈

- [ ] 报名支付 CONFIRMED：toast「支付成功」，自动返回活动详情页，详情页呈现已报名态
- [ ] 分享直达报名页（无栈）支付成功：redirectTo 详情页兜底
- [ ] 签到续办流（resumeCheckIn）：保留「继续签到」结果态，不自动返回
- [ ] 支付后草稿不被回写（无「编辑」残留草稿）

### MIW-99 人才能力筛选

- [ ] 人才合作筛选选「死美工」：结果全部为发布卡角色=视觉设计的用户（角标为死美工）
- [ ] 混合筛选（能力+行业）：口径正确
- [ ] 尊重 $.abilities 可见性（隐藏能力者不因回退路径泄漏）

### MIW-100 / MIW-105 资产

- [ ] 合作卡六角色插画正常渲染（webp）；等级页 hero/盲盒图正常
- [ ] 徽章兜底图、登录 sheet logo 不缺图
- [ ] talent-card 右下角「MIP平台」邀请人头像 = 新品牌图（圆形、清晰）
- [ ] 体验版（真机口径）上述资产全部可见（ignoreUploadUnusedFiles 剔除验证）

### MIW-107 通知链路

- [ ] 触发合作意向/感兴趣标记通知：微信订阅消息到达，发起人昵称正确（非空、非用户表缺省值）
- [ ] 昵称缺失者触发：回退「有人」

## 五、体验版发布

- [ ] `pnpm build` 通过（嵌套 vendor 树断言过、pruned 非 0）
- [ ] dist 健康检查：`dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm/` 存在；无 IDE npm 构建杂物（`.wechatide.ib.json` 等）
- [ ] 平台体积报告主包 < 2048KB
- [ ] dist 平铺临时工程上传体验版（版本 `0.2.0.20261014.3`，更新说明含本批主题）
- [ ] 体验版二维码可打开、核心页面无白屏

## 六、真机边界（external-wait，记录不阻塞）

- 手机号授权、支付、扫码签到、订阅消息授权消费、录音、视频号跳转
- MIW-106 toast 观感与返回转场、MIW-101 红心动画帧率、MIW-105 头像真机清晰度

## 结论

（执行后填写：通过项 / 阻塞项 / external-wait 项 / 版本号）
