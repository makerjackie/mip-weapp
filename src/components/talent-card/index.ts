// 嘉宾卡/人才卡统一业务组件：
// - layout="horizontal"（默认）：人才合作/找人才横版卡（figma 1768_37534），底部左角色标签、右邀请人。
// - layout="grid"：活动参与人、嘉宾/互动/心动/访客等双列竖版卡（figma 1818_17230/1732_19323），
//   左上角 Lv、右上角 corner 插槽（心动/×N/未读等页面自有事实）、底部左勋章、右邀请人。
// medals 只接服务端佩戴口径（mip_user_badge_equipment 已过滤未佩戴），组件兜底最多展示 3 枚；
// 未返回的勋章不造值。inviterKind：'PLAYER' 玩家邀请人（昵称+头像）/ 'PLATFORM' MIP 平台
// （平台名+平台系统头像）；玩家与平台的判定规则由服务端口径决定，调用方传入，组件不判定。
// MIW-52 统一竖版卡：tags=固定三标签（地区MIP | 代表行业 | 身份状态），组件过滤空值并
// 兜底最多 3 个，缺省回退 metaText；footRightMode：'inviter'（默认，右下邀请人/targetText）
// / 'custom'（渲染 foot-right 插槽，如 NPC 任务分配勾选态），右上角沿用 corner 插槽。
const MAX_MEDALS = 3
const MAX_TAGS = 3
const PLATFORM_INVITER_NAME = 'MIP平台'
const PLATFORM_INVITER_AVATAR = '/assets/brand/mip-logo-yellow.png'

interface TalentMedal {
  id: string
  imageUrl?: string
}

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    layout: { type: String, value: 'horizontal' },
    displayName: { type: String, value: 'MIP 用户' },
    kindLabel: { type: String, value: '' },
    avatarUrl: { type: String, value: '' },
    avatarRing: { type: Boolean, value: false },
    leftAlignBody: { type: Boolean, value: false },
    metaText: { type: String, value: '' },
    tags: { type: Array, value: [] },
    footRightMode: { type: String, value: 'inviter' },
    supportingText: { type: String, value: '' },
    levelText: { type: String, value: '' },
    leadLabel: { type: String, value: '' },
    statusText: { type: String, value: '' },
    unread: { type: Boolean, value: false },
    roleNames: { type: Array, value: [] },
    roleTags: { type: Array, value: [] },
    medals: { type: Array, value: [] },
    inviterName: { type: String, value: '' },
    inviterAvatarUrl: { type: String, value: '' },
    inviterKind: { type: String, value: 'PLAYER' },
    targetText: { type: String, value: '' },
  },
  data: {
    displayMedals: [] as TalentMedal[],
    displayTags: [] as string[],
    inviter: { name: '', avatarUrl: '', platform: false },
  },
  observers: {
    'medals, inviterName, inviterAvatarUrl, inviterKind': function (
      medals: TalentMedal[],
      inviterName: string,
      inviterAvatarUrl: string,
      inviterKind: string,
    ) {
      const platform = inviterKind === 'PLATFORM'
      const name = inviterName || (platform ? PLATFORM_INVITER_NAME : '')
      this.setData({
        displayMedals: (Array.isArray(medals) ? medals : []).slice(0, MAX_MEDALS),
        inviter: { name, avatarUrl: platform ? (inviterAvatarUrl || PLATFORM_INVITER_AVATAR) : inviterAvatarUrl, platform },
      })
    },
    'tags': function (tags: string[]) {
      this.setData({
        displayTags: (Array.isArray(tags) ? tags : []).filter(tag => !!tag).slice(0, MAX_TAGS),
      })
    },
  },
})
