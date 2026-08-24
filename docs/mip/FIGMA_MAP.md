# Figma 页面映射

设计文件：[MIP](https://www.figma.com/design/qqkbdlh4c4Swubum8S3F2f/MIP?node-id=69-4972)。节点映射来自固定 PRD、画板链接和已能观察到的页面层级；当前 MCP Starter 调用额度不足，尚未取得可复核的完整 design context、切图或同尺寸 frame 截图。因此本文件只固定页面映射和已明确的业务批注，不把链接可打开或浏览器观察描述为视觉验收证据。

## 主导航

固定设计输入采用四个主 Tab，顺序为：

1. 发现
2. 活动
3. 机会
4. 我的

选中态使用 MIP 黄，页面主体使用黑色背景和深灰面板。管理能力不进入主 Tab，继续放在“我的”内的受控入口。

## 设计节点

| 区域 | 页面节点 | 代表 frame | 代码目标 |
| --- | --- | --- | --- |
| 我的 | `69:4972` | `1770:38871` 我的 | `src/pages/profile` |
| 我的活动/订单 | `69:4972` | `1723:16217`、`1723:16988` | `src/packages/member/mip-events/mine`、`src/packages/member/orders` |
| 编辑档案 | `69:4972` | `1732:20291` | `src/packages/member/mip-profile` |
| 合作卡 | `69:4972` | `2004:2227`、`2571:34139` | `src/packages/member/mip-cooperation` |
| 超级案例 | `69:4972` | `1987:30162`、`2173:42605` | `src/packages/member/mip-cases` |
| AI 语音填写 | `69:4972` | `2172:42168` | `src/packages/member/mip-ai` |
| 玩家等级 | `69:4972` | `1948:14079` | `src/packages/member/mip-growth` |
| 活动首页 | `69:4975` | `1819:17664` | `src/pages/events` |
| 活动详情 | `69:4975` | `1861:17860`、`1818:17142` | `src/packages/member/mip-events/detail` |
| 参与人/互动 | `69:4975` | `1818:17230`、`2168:17419` | `src/packages/member/mip-events/participants`、`src/packages/member/mip-events/interaction` |
| 活动报名 | `69:4975` | `1821:19274` | `src/packages/member/mip-events/registration` |
| 机会探索 | `69:4976` | `1766:36567` | `src/pages/opportunities` |
| 发布机会 | `69:4976` | `1766:36864` | `src/packages/member/mip-opportunities/editor` |
| 机会详情 | `69:4976` | `1768:37414`、`1768:37369` | `src/packages/member/mip-opportunities/detail` |
| 人才合作 | `69:4976` | `1768:37534`、`2917:4875` | `src/packages/member/mip-cooperation/list` |
| 玩家档案 | `69:4976` | `1769:38198` | `src/packages/member/mip-public-profile` |
| 超级案例详情 | `69:4976` | `1958:11897`、`2037:12261` | `src/packages/member/mip-cases/detail` |
| 行业筛选 | `69:4976` | `2917:4785` | `src/config/mip-catalogs.ts` 与机会/档案页面筛选控件 |
| 找人才 | `69:4976` | `1768:37534`、`2917:4875` | `src/packages/member/mip-people`（全局/玩家范围、行业和能力筛选） |
| 我的相关机会 | `69:4976` | `1768:37414` | `src/packages/member/mip-opportunities/mine`（我发布、引荐给我） |
| 发布机会团队成员 | `69:4976` | `1766:36864` | `src/packages/member/mip-opportunities/editor`（最多 8 名有效玩家） |
| 机会被引荐人 | `69:4976` | `1768:37369` | `src/packages/member/mip-opportunities/detail`（可见玩家/嘉宾选择与替换） |
| 公司与组织经历 | `69:4972` | `1732:20291` | `src/packages/member/mip-profile`（两组独立列表、排序和数量上限） |
| 活动介绍媒体 | `69:4975` | `1818:17142` | `src/packages/admin/events`、`src/packages/member/mip-events/detail`（上传、排序、预览） |
| 谁看过我 | `69:4972` | `1770:38871` | `src/pages/profile`、`src/packages/member/mip-received`、`src/packages/member/mip-public-profile`（入口、访客列表、访问记录） |

## 当前本地实现证据

- 活动首页已实现配置化 Banner、视频号入口、近期/往期、城市、关键词、单日与日期范围筛选、分页和活动卡分享；筛选后会显示对应中文日期标签。
- 活动详情已实现图文和介绍媒体、主办方、须知、支持电话、地图/地址 fallback、参与人搜索、邀请来源、分享入口及报名恢复。地图、拨号、码图、相册和媒体选择仍需真机验收。
- 签到 scene、报名后恢复、无效码恢复、管理端签到海报、双向心动列表和反馈已形成源码链路；真实扫码、Canvas、相册和订阅消息仍需真机或正式配置。
- 机会详情已显示发布时间、团队成员和默认封面，并可进入使用 opaque reference 的公开档案。
- 合作卡“预览”会先保存当前字段；保存失败不会进入预览。该合同由 `tests/mip-cooperation-preview.test.ts` 固定。
- 公开档案访问使用一次性页面 visit key 记录；本人访客页按最新访问展示累计次数和未读状态。迁移与服务合同由 `database/mysql/mip/023_profile_visits.sql` 和 `cloudfunctions/mip-opportunities-api/tests/profile-visits.test.js` 固定。

以上只说明本地行为已映射，不代替 Figma 同尺寸截图对照、微信开发者工具 ready-state 或真机验收。

## 画板批注转成的业务合同

- 机会按发布时间倒序；编辑后刷新发布时间；详情明确展示发布时间。
- 机会筛选提供角色、行业、能力和城市；人才入口切换“只搜玩家 / 全局搜索”，默认全局搜索。
- 行业一级分类只作分组，二级标签可多选；筛选面板使用明确的“确认筛选”操作。
- 行业和城市筛选沿用注册页的两级/热门标签结构；未选择具体项时表示“不限”，不把一级分类当成可选标签。
- 发布机会可选择最多 8 名有效玩家作为团队成员；详情和公开档案只使用可见的 profile reference。
- 引荐动作必须选择可见的玩家或嘉宾，被引荐人可替换；“我发布”和“引荐给我”是两组独立事实。
- 活动介绍图片显示上传顺序，支持说明文字、上移、下移、移除和预览；运行时仍需真机验证媒体选择和失败清理。
- 进入个人主页记录一次访问；同一次页面打开幂等，重复打开累计，最新访问优先，未读红点只在本人页面显示。
- 合作卡编辑点击“预览”先保存当前字段，再显示预览；保存失败时保留编辑状态并提示重试。
- 玩家/嘉宾列表按加入时间倒序；引荐和感兴趣列表要有未读状态。
- 每人对一条机会最多一次有效引荐，可取消后重建。
- 每人对另一用户最多一次有效感兴趣，可取消后重建。
- 发布人可以编辑、结束机会；普通用户不能删除，平台运营可处理。
- 主营城市来自标签库；未上传机会封面时使用平台默认封面。
- 活动首页默认选择当前城市，可切换到已有城市分会。
- 受保护动作触发登录弹层；登录和资料补全完成后恢复原动作。

业务规则与视觉冲突时，以 [REQUIREMENTS.md](REQUIREMENTS.md) 和 [../../CONTEXT.md](../../CONTEXT.md) 为准，并在设计验收记录中标注差异。
