# 代表行业取数与配置审查（2026-10-19）

- 个人资料通过 `mipIdentityModule.listProfileTags()` 读取身份服务，服务端 `mip_tags` 的 `kind=INDUSTRY`、`enabled=1` 目录为运行时事实；一级父分类不可选，二级子行业可选。主行业单选，持久化到 `mip_profile_tags` 的 `PRIMARY_INDUSTRY` 关系。
- 飞书来源：标签数据管理 / 行业标签库，table `tblKgp2qI3mHhTOk`。仓库快照为 2026-09-26 / revision 62，11 个实际分组、121 个子行业、13 个热门子行业；“不限”映射清除选择，不创建 `-` 行业。
- 2026-08-22 需求澄清纪要明确 AME 补充上传两级标签库，热门行业和城市在飞书表单维护。这证明配置来源，不能推导 Web 后台已完成行业库编辑。
- 当前导入脚本是 `scripts/import-feishu-catalog.mjs`：读取仓库来源快照，默认仅预览，写入需明确目标环境和有效备份；不会实时自动同步飞书。保留旧标签 ID 和未匹配历史值。
- 已审查 Web 页面、表单、公开服务合同与服务端：后台可以选择既有行业；活动“标签设置”的目录仅 TYPE/TAG，资源为 EVENT_TYPE/EVENT_TAG。没有维护 mip_tags 行业的新增/编辑/停用接口或对应后台入口，不能当作行业库编辑器。
- 粒度建议：保留两级完整业务目录，以热门项和分类减少选择成本；源表中的“美容、美发、美容/美发”等语义重叠应由业务方确认后整理，不能静默合并已引用标签。本轮未改行业值或生产库。

来源：[飞书行业表](https://mcnb87a9myxx.feishu.cn/wiki/AhjxwoeCMiYsUzkhsR3cmD3unqg?table=tblKgp2qI3mHhTOk)。快照不代表飞书当前实时版本。

代码：`src/packages/member/mip-profile/index.ts`、`src/modules/mip-identity/tag-catalog.ts`、`cloudfunctions/mip-identity-api/domain/repository.js`、`cloudfunctions/mip-admin-api/domain/event-catalogs.js`、`packages/admin-contracts/src/generated/admin-operation-contract.ts`。
