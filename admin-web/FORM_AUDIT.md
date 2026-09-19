# admin-web 弹窗表单全量排查与载体判定

排查范围：admin-web 全部 14 个页面中所有通过 `MutationDialog`（Modal）或 `DetailDrawer` 发起的表单操作。
判定标准：见 [INTERACTION_SPEC.md](./INTERACTION_SPEC.md) 第 3 节。

## 判定结论汇总

| # | 操作动作 | 页面 | 可见字段数 | 嵌套列表 | 需对照上下文 | 判定 | 理由 |
|---|---------|------|-----------|---------|------------|------|------|
| 1 | `mip.admin.events.save` | 活动 | 30+ | 报名字段配置（动态行） | 是 | **改独立页面** | 字段最多、有嵌套动态列表、需对照封面和媒体 |
| 2 | `mip.admin.opportunities.save` | 机会与内容 | 12+（含 draft 分组） | commercialTerms 嵌套、roleKeys 多选 | 是 | **改独立页面** | 分组嵌套、需对照角色和商业条件 |
| 3 | `mip.admin.userContent.save` | 机会与内容 | 10+（含 draft 分组） | roleFields 动态、abilityScores 动态、mediaAssetIds | 是 | **改独立页面** | 两种 kind 字段结构不同，需对照上下文 |
| 4 | `mip.admin.tasks.save` | 任务 | 8 | eligibleLevelIds 多选 | 否 | **改独立页面** | 字段数达上限、多选等级需对照候选列表 |
| 5 | `mip.admin.tasks.assignMembers` | 任务 | 1 | multi-select 成员列表 | 是（需看候选） | **保留弹窗** | 单字段，但选项来自上下文；抽屉内弹窗即可 |
| 6 | `mip.admin.tasks.revokeMembers` | 任务 | 1 | multi-select 成员列表 | 是 | **保留弹窗** | 同上 |
| 7 | `mip.admin.events.registrations.review` | 活动 | 1（decision） | 无 | 否 | **保留弹窗** | 单选操作，弹窗或抽屉快捷按钮 |
| 8 | `mip.admin.events.checkIn` | 活动 | 0（仅版本） | 无 | 否 | **保留弹窗** | 无需填写，确认即可 |
| 9 | `mip.admin.events.undoCheckIn` | 活动 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段原因 |
| 10 | `mip.admin.events.album.review` | 活动 | 2（decision+reason） | 无 | 否 | **保留弹窗** | 两字段，弹窗内完成 |
| 11 | `mip.admin.events.policy.save` | 活动 | 1 | 无 | 否 | **保留弹窗** | 单字段数值 |
| 12 | `mip.admin.events.tags.replace` | 活动 | 1（tagIds） | 无 | 否 | **保留弹窗** | 单字段多选 |
| 13 | `mip.admin.events.catalog.save` | 活动 | 5 | 无 | 否 | **保留弹窗** | 字段适中，弹窗可承载 |
| 14 | `mip.admin.events.catalog.changeStatus` | 活动 | 1 | 无 | 否 | **保留弹窗** | 单选操作 |
| 15 | `mip.admin.events.catalog.archive` | 活动 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段原因 |
| 16 | `mip.admin.events.clone` | 活动 | 0（仅版本） | 无 | 否 | **保留弹窗** | 无需填写 |
| 17 | `mip.admin.events.changeStatus` | 活动 | 0（仅版本） | 无 | 否 | **保留弹窗** | 发布/下架，确认即可 |
| 18 | `mip.admin.events.archive` | 活动 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段原因 |
| 19 | `mip.admin.memberships.grant` | 用户 | 2 | 无 | 否 | **保留弹窗** | 时长下拉 + 原因 |
| 20 | `mip.admin.users.update` | 用户 | 3 | 无 | 否 | **保留弹窗** | 三个文本字段 |
| 21 | `mip.admin.users.changePrimaryBranch` | 用户 | 1 | 无 | 否 | **保留弹窗** | 单选下拉 |
| 22 | `mip.admin.users.setControl` | 用户 | 1 | 无 | 否 | **保留弹窗** | 单选操作 |
| 23 | `mip.admin.roles.set` | 权限 | 1 | 无 | 否 | **保留弹窗** | 单选角色 |
| 24 | `mip.admin.rolePolicies.update` | 权限 | 3 | capabilities 多选 | 否 | **保留弹窗** | 字段适中，多选有选项 |
| 25 | `mip.admin.branches.create` | 权限 | 3 | 无 | 否 | **保留弹窗** | 三个字段 |
| 26 | `mip.admin.branches.update` | 权限 | 3 | 无 | 否 | **保留弹窗** | 三个字段 |
| 27 | `mip.admin.branches.changeStatus` | 权限 | 0（仅版本） | 无 | 否 | **保留弹窗** | 确认即可 |
| 28 | `mip.admin.refunds.submit` | 订单 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段原因 |
| 29 | `mip.admin.communications.publishEventReminder` | 活动 | 1（checkbox） | 无 | 否 | **保留弹窗** | 单勾选 |
| 30 | `mip.admin.announcements.save` | 运营记录 | 7 | 无 | 否 | **保留弹窗** | 字段适中，弹窗可承载 |
| 31 | `mip.admin.announcements.publish` | 运营记录 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 32 | `mip.admin.announcements.withdraw` | 运营记录 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 33 | `mip.admin.announcements.pin` | 运营记录 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 34 | `mip.admin.messageCampaigns.save` | 消息 | 6 | recipientRefs 列表 | 否 | **保留弹窗** | 字段适中，列表用多选 |
| 35 | `mip.admin.messageCampaigns.snapshot` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 36 | `mip.admin.messageCampaigns.schedule` | 消息 | 1（datetime） | 无 | 否 | **保留弹窗** | 单字段 |
| 37 | `mip.admin.messageCampaigns.cancelSchedule` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 38 | `mip.admin.messageCampaigns.publish` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 39 | `mip.admin.messageCampaigns.withdraw` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 40 | `mip.admin.messageTemplates.save` | 消息 | 5 | 无 | 否 | **保留弹窗** | 字段适中 |
| 41 | `mip.admin.messageTemplates.activate` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 42 | `mip.admin.messageTemplates.archive` | 消息 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 43 | `mip.admin.communityReports.claim` | 运营记录 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 44 | `mip.admin.communityReports.close` | 运营记录 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段 |
| 45 | `mip.admin.opportunities.publish` | 机会与内容 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 46 | `mip.admin.opportunities.end` | 机会与内容 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 47 | `mip.admin.opportunities.unpublish` | 机会与内容 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 48 | `mip.admin.opportunities.archive` | 机会与内容 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段 |
| 49 | `mip.admin.userContent.unpublish` | 机会与内容 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段 |
| 50 | `mip.admin.userContent.archive` | 机会与内容 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段 |
| 51 | `mip.admin.knowledge.contents.save` | 知识库 | 12+ | 无 | 否 | **改独立页面** | 字段数超过弹窗上限 |
| 52 | `mip.admin.knowledge.contents.review` | 知识库 | 2（decision+reason） | 无 | 否 | **保留弹窗** | 两字段 |
| 53 | `mip.admin.knowledge.schedules.save` | 知识库 | 5 | 无 | 否 | **保留弹窗** | 字段适中 |
| 54 | `mip.admin.badges.grant` | 成长与勋章 | 2 | 无 | 否 | **保留弹窗** | 两字段 |
| 55 | `mip.admin.badges.revoke` | 成长与勋章 | 1（reason） | 无 | 否 | **保留弹窗** | 单字段 |
| 56 | `mip.admin.growth.adjust` | 成长与勋章 | 2 | 无 | 否 | **保留弹窗** | 两字段 |
| 57 | `mip.admin.tasks.publish` | 任务 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 58 | `mip.admin.tasks.unpublish` | 任务 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 59 | `mip.admin.tasks.delete` | 任务 | 0 | 无 | 否 | **保留弹窗** | 确认即可 |
| 60 | `mip.admin.banner.*` (save/changeStatus) | Banner | 4–5 | 无 | 否 | **保留弹窗** | 字段适中 |

## 需改独立页面的表单（6 个）

1. **活动新建/编辑** `mip.admin.events.save` — 30+ 字段 + 报名字段配置动态列表 → `/events/$eventId/edit`
2. **机会创建/编辑** `mip.admin.opportunities.save` — 分组嵌套 + 商业条件 + 角色多选 → `/opportunities/$opportunityId/edit`
3. **合作卡/超级案例创建编辑** `mip.admin.userContent.save` — 两种 kind 结构 + 动态角色字段 → `/userContent/$contentId/edit`
4. **任务创建/编辑** `mip.admin.tasks.save` — 8 字段 + 等级多选 + 需对照候选 → `/tasks/$taskId/edit`
5. **知识内容创建/编辑** `mip.admin.knowledge.contents.save` — 12+ 字段 → `/knowledge/$contentId/edit`

## 保留弹窗的表单

其余 55 个操作保持弹窗或抽屉内完成，字段数 ≤8、无嵌套动态列表、无需对照上下文。
