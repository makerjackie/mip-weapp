# Figma 页面映射

设计文件：[MIP](https://www.figma.com/design/qqkbdlh4c4Swubum8S3F2f/MIP?node-id=69-4972)。实现页面前读取目标 frame 的 design context 和截图；只看页面级 metadata 不足以还原视觉。

## 主导航

Figma 已确认四个主 Tab，顺序固定为：

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

## 画板批注转成的业务合同

- 机会按发布时间倒序；编辑后刷新发布时间。
- 玩家/嘉宾列表按加入时间倒序；引荐和感兴趣列表要有未读状态。
- 每人对一条机会最多一次有效引荐，可取消后重建。
- 每人对另一用户最多一次有效感兴趣，可取消后重建。
- 发布人可以编辑、结束机会；普通用户不能删除，平台运营可处理。
- 主营城市来自标签库；未上传机会封面时使用平台默认封面。
- 活动首页默认选择当前城市，可切换到已有城市分会。
- 受保护动作触发登录弹层；登录和资料补全完成后恢复原动作。

业务规则与视觉冲突时，以 [REQUIREMENTS.md](REQUIREMENTS.md) 和 [../../CONTEXT.md](../../CONTEXT.md) 为准，并在设计验收记录中标注差异。
