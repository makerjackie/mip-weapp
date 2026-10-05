import type { GrowthLevel, GrowthSnapshot } from '../../../modules/mip-growth'
import type { UserTaskCard } from '../../../modules/mip-tasks'
import { brand } from '../../../config/brand'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipTasksModule } from '../../../modules/mip-tasks/client'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatLocalDate } from '../../../utils/date'
import { withinRenewalWindow } from './renewal-window'

/** journey-review J1-07：会员订单确认页（开通与续费共用）。 */
const MEMBERSHIP_ORDER_PAGE = '/packages/member/membership-order/index'

/** MIW-27：经验值详情独立页（figma 1948:14177 经验值明细）。 */
const EXPERIENCE_DETAILS_PAGE = '/packages/member/mip-experience-details/index'

/** 到期时间展示为 2026.08.08（figma 1948:14079 / 3296:5808）。 */
function formatDottedDate(value: string) {
  return formatLocalDate(value).replaceAll('-', '.')
}

interface GrowthTaskView extends UserTaskCard {
  actionText: string
}

/** figma 1948_14079: three-point level scale under the hero — first level, middle milestone (locked), last level. */
interface LevelScaleView {
  leftText: string
  centerText: string
  rightText: string
  centerLocked: boolean
}

function levelScaleView(levels: GrowthLevel[], currentLevelNumber: number): LevelScaleView | null {
  if (levels.length < 3) {
    return null
  }
  const last = levels.length
  const center = Math.floor((last - 1) / 2) + 1
  return {
    leftText: 'Lv.1',
    centerText: `Lv.${center}`,
    rightText: `Lv.${last}`,
    centerLocked: center > currentLevelNumber,
  }
}

function growthPresentation(snapshot: GrowthSnapshot) {
  const currentIndex = snapshot.levels.findIndex(level => level.id === snapshot.currentLevel.id)
  const currentLevelNumber = Math.max(1, currentIndex + 1)
  return {
    currentLevelNumber,
    nextLevelThreshold: snapshot.nextLevel?.minimumExperience || 0,
    levelScale: levelScaleView(snapshot.levels, currentLevelNumber),
  }
}

function taskView(task: UserTaskCard): GrowthTaskView {
  const completed = task.status === 'COMPLETED'
  const ended = task.status === 'ENDED'
  return {
    ...task,
    name: task.name === '完善合作资料' ? '完善资料' : task.name,
    actionText: completed ? '已完成' : ended ? '已截止' : '去完成',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    snapshot: null as GrowthSnapshot | null,
    currentLevelNumber: 1,
    nextLevelThreshold: 0,
    levelScale: null as LevelScaleView | null,
    tasksState: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as GrowthTaskView[],
    tasksMessage: '',
    isPlayer: false,
    membershipState: 'loading' as 'loading' | 'player' | 'guest' | 'error',
    membershipValidityText: '',
    renewWindowOpen: false,
    invitationReady: false,
    invitationMessage: '',
    message: '',
  },
  shareInvitationToken: '',
  growthRequestSeq: 0,
  tasksRequestSeq: 0,

  onLoad() {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.presentSnapshot(cached)
    }
  },

  onShow() {
    // Completing a task or drawing a blind box changes server-owned balances while this page is hidden.
    void this.loadGrowth(true)
    void this.loadMembershipActions()
    void this.loadTasks(true)
  },

  onHide() {
    this.growthRequestSeq += 1
    this.tasksRequestSeq += 1
  },

  async loadMembershipActions() {
    let membership
    try {
      membership = await mipCommerceModule.getMembershipBenefits()
    }
    catch {
      this.shareInvitationToken = ''
      this.setData({
        isPlayer: false,
        membershipState: 'error',
        membershipValidityText: '',
        renewWindowOpen: false,
        invitationReady: false,
        invitationMessage: '',
      })
      return
    }
    if (membership.kind !== 'PLAYER') {
      this.shareInvitationToken = ''
      this.setData({
        isPlayer: false,
        membershipState: 'guest',
        // J1-06 开通态：新玩家加入页固定展示「有效期一年」（M1 00:45:19）。
        membershipValidityText: '有效期一年',
        renewWindowOpen: false,
        invitationReady: false,
        invitationMessage: '',
      })
      return
    }
    this.setData({
      isPlayer: true,
      membershipState: 'player',
      // J4-03 续费态：有效期至:2026.08.08（figma 1948:14079）。
      membershipValidityText: `有效期至:${formatDottedDate(membership.membershipEndsAt)}`,
      renewWindowOpen: withinRenewalWindow(membership.membershipEndsAt),
      invitationReady: false,
      invitationMessage: '',
    })
    try {
      const invitation = await mipCommerceModule.createMembershipInvitation()
      this.shareInvitationToken = invitation.token
      this.setData({ invitationReady: true })
    }
    catch {
      this.shareInvitationToken = ''
      this.setData({ invitationReady: false, invitationMessage: '邀请暂时不可用，请稍后重试。' })
    }
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([
        this.loadGrowth(true),
        this.loadMembershipActions(),
        this.loadTasks(true),
      ])
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadGrowth(force = false) {
    const requestSeq = ++this.growthRequestSeq
    if (!this.data.snapshot) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const snapshot = await mipGrowthModule.getSnapshot({ force })
      if (requestSeq !== this.growthRequestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        snapshot,
        ...growthPresentation(snapshot),
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.growthRequestSeq) {
        return
      }
      this.setData(this.data.snapshot
        ? { message: '成长记录更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '成长记录加载失败' })
    }
  },

  presentSnapshot(snapshot: GrowthSnapshot) {
    this.setData({
      state: 'ready',
      snapshot,
      ...growthPresentation(snapshot),
    })
  },

  async loadTasks(force = false) {
    const requestSeq = ++this.tasksRequestSeq
    if (!this.data.tasks.length) {
      this.setData({ tasksState: 'loading', tasksMessage: '' })
    }
    try {
      const page = await mipTasksModule.query.listTasks(undefined, 4, force)
      if (requestSeq !== this.tasksRequestSeq) {
        return
      }
      const tasks = page.items.map(taskView)
      this.setData({
        tasksState: tasks.length ? 'ready' : 'empty',
        tasks,
        tasksMessage: '',
      })
    }
    catch {
      if (requestSeq !== this.tasksRequestSeq) {
        return
      }
      this.setData({
        tasksState: this.data.tasks.length ? 'ready' : 'error',
        tasksMessage: '请稍后重试。',
      })
    }
  },

  openTasks() {
    void wx.navigateTo({ url: '/packages/member/mip-tasks/index' })
  },

  openTask(event: WechatMiniprogram.TouchEvent) {
    const taskId = String(event.currentTarget.dataset.id || '')
    if (taskId) {
      void wx.navigateTo({ url: `/packages/member/mip-tasks/detail/index?taskId=${taskId}` })
    }
  },

  openBenefits() {
    void wx.navigateTo({ url: '/packages/member/benefits/index' })
  },

  /** MIW-27：经验值详情跳转独立明细页（figma 1948:14177），不再原地展开滚动。 */
  openExperienceDetails() {
    void wx.navigateTo({ url: EXPERIENCE_DETAILS_PAGE })
  },

  /** J1-06 开通态「立即加入」→ 会员订单确认页（J1-07）。 */
  openMembershipOrder() {
    caseNavigateTo({ url: `${MEMBERSHIP_ORDER_PAGE}?source=growth-join` })
  },

  /** J4-03「立即续费」→ 同一会员订单确认页（J1-07）。 */
  renewMembership() {
    caseNavigateTo({ url: `${MEMBERSHIP_ORDER_PAGE}?source=growth-renew` })
  },

  onShareAppMessage() {
    const invitation = this.shareInvitationToken
      ? `&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
      : ''
    return {
      title: 'MIP 会员方案',
      // MIW-27 第二轮：邀请卡片先统一用品牌默认封面图。
      imageUrl: brand.opportunityDefaultCoverPath,
      path: `/pages/membership/index?source=growth-share${invitation}`,
    }
  },
})
