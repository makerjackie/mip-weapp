# MIW-85 邀请人展示统一 — 浏览器走查证据（2026-10-13）

DevTools automator（staging 真库，体验 viewer = 铭龙，ACTIVE 玩家）端到端走查截图。口径见任务卡：INVITER-01 卡片统一展示「最近一次活动邀请人」（含跨场聚合列表）、INVITER-02 玩家不显示邀请人（含 PLATFORM 归档）、INVITER-03 自然流量显示「MIP 平台」、INVITER-04 我的档案页不显示邀请人。

| 截图 | 场景 | 断言 |
| --- | --- | --- |
| `inviter04-profile-page.png` | 我的档案页 | 页面无任何邀请人标注（INVITER-04） |
| `inviter01-02-visitors.png` | 我的 → 访客（跨场聚合） | 唐乔/苏禾 footer「铭龙邀请」（最新归档）；程序员helps程序员「MIP 平台」徽标（INVITER-03）；玩家行无邀请人 footer（INVITER-02） |
| `inviter01-02-interactions.png` | 我的 → 互动过 | 同访客口径（服务端同一 `loadHeartInviters` 收口） |
| `inviter01-events-guests.png` | 活动参与人页 GUEST tab | 顾宁/唐乔嘉宾卡「铭龙邀请」 |
| `inviter02-events-public-players.png` | 活动参与人页公开玩家 tab | 玩家卡响应无 `inviter` 键（服务端门控，非前端隐藏） |
| `inviter01-02-talents.png` | 机会 → 人才合作 | 唐乔/苏禾「铭龙邀请」；陈远/周衡（无归档）无邀请人；林夏（玩家，最新归档 = 周衡）无邀请人 = INVITER-02 最强实证 |

数据核对：每张截图均与 staging 真库 `mip_event_invitation_attributions` 最新一条（`captured_at` DESC tie-break `registration_id` DESC）+ `mip_membership_entitlements` ACTIVE 玩家集合交叉比对一致；`mip-hearts` 心动值列表（ACTIVE_INTEREST）当期无数据，行为由 `tests/mip-heart-inviter-parity.test.ts` 与云端函数测试钉住。

部署回读：`mip-events-api` ModTime=2026-10-13 16:47:30、`mip-opportunities-api` ModTime=2026-10-13 16:48:10，均 Status=Active（GetFunction）。
