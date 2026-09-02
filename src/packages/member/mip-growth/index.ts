import type { GrowthEntry, GrowthLevel, GrowthRule, GrowthSnapshot } from '../../../modules/mip-growth'
import type { UserTaskCard } from '../../../modules/mip-tasks'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipGrowthModule } from '../../../modules/mip-growth/client'
import { mipTasksModule } from '../../../modules/mip-tasks/client'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatLocalDate } from '../../../utils/date'

const metricLabels = {
  EXPERIENCE: '经验值',
  CONTRIBUTION: '贡献值',
  COIN: '游戏币',
} as const

interface GrowthEntryView extends GrowthEntry {
  metricLabel: string
  deltaText: string
  createdText: string
}

interface GrowthLevelView extends GrowthLevel {
  levelNumber: number
  thresholdText: string
  current: boolean
  reached: boolean
}

interface GrowthRuleView extends GrowthRule {
  metricLabel: string
  deltaText: string
  dailyLimitText: string
}

interface GrowthTaskView extends UserTaskCard {
  actionText: string
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function entryView(entry: GrowthEntry): GrowthEntryView {
  return {
    ...entry,
    metricLabel: metricLabels[entry.metric],
    deltaText: entry.deltaValue > 0 ? `+${entry.deltaValue}` : String(entry.deltaValue),
    createdText: dateText(entry.createdAt),
  }
}

function levelView(level: GrowthLevel, currentLevelId: string, levelNumber: number, currentLevelNumber: number): GrowthLevelView {
  return {
    ...level,
    levelNumber,
    thresholdText: level.minimumExperience === 0 ? '基础等级' : `${level.minimumExperience} 经验值`,
    current: level.id === currentLevelId,
    reached: levelNumber <= currentLevelNumber,
  }
}

function ruleView(rule: GrowthRule): GrowthRuleView {
  const metricLabel = metricLabels[rule.metric]
  return {
    ...rule,
    metricLabel,
    deltaText: `${rule.deltaValue > 0 ? '+' : ''}${rule.deltaValue} ${metricLabel}`,
    dailyLimitText: rule.dailyLimitValue === undefined
      ? '无每日上限'
      : `每日最多 ${rule.dailyLimitValue} ${metricLabel}`,
  }
}

function taskView(task: UserTaskCard): GrowthTaskView {
  const completed = task.status === 'COMPLETED'
  const ended = task.status === 'ENDED'
  return {
    ...task,
    actionText: completed ? '已完成' : ended ? '已截止' : '去完成',
  }
}

function growthPresentation(snapshot: GrowthSnapshot) {
  const currentIndex = snapshot.levels.findIndex(level => level.id === snapshot.currentLevel.id)
  const currentLevelNumber = Math.max(1, currentIndex + 1)
  return {
    currentLevelNumber,
    nextLevelNumber: snapshot.nextLevel ? currentLevelNumber + 1 : 0,
    nextLevelThreshold: snapshot.nextLevel?.minimumExperience || 0,
    levels: snapshot.levels.map((level, index) => levelView(
      level,
      snapshot.currentLevel.id,
      index + 1,
      currentLevelNumber,
    )),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    snapshot: null as GrowthSnapshot | null,
    currentLevelNumber: 1,
    nextLevelNumber: 0,
    nextLevelThreshold: 0,
    levels: [] as GrowthLevelView[],
    earningRules: [] as GrowthRuleView[],
    entries: [] as GrowthEntryView[],
    nextCursor: '',
    loadingMore: false,
    tasksState: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    tasks: [] as GrowthTaskView[],
    tasksMessage: '',
    isPlayer: false,
    membershipState: 'loading' as 'loading' | 'player' | 'guest' | 'error',
    membershipEndsText: '',
    invitationReady: false,
    invitationMessage: '',
    message: '',
  },
  shareInvitationToken: '',

  onLoad() {
    const cached = mipGrowthModule.peekSnapshot()
    if (cached) {
      this.presentSnapshot(cached)
    }
    void this.loadGrowth()
  },

  onShow() {
    void this.loadMembershipActions()
    void this.loadTasks()
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
        membershipEndsText: '',
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
        membershipEndsText: '',
        invitationReady: false,
        invitationMessage: '',
      })
      return
    }
    this.setData({
      isPlayer: true,
      membershipState: 'player',
      membershipEndsText: formatLocalDate(membership.membershipEndsAt),
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
    if (!this.data.snapshot) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [snapshot, page] = await Promise.all([
        mipGrowthModule.getSnapshot({ force }),
        mipGrowthModule.listEntries(undefined, 20),
      ])
      const presentation = growthPresentation(snapshot)
      this.setData({
        state: 'ready',
        snapshot,
        ...presentation,
        earningRules: snapshot.earningRules.map(ruleView),
        entries: page.items.map(entryView),
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
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
      earningRules: snapshot.earningRules.map(ruleView),
    })
  },

  async loadTasks(force = false) {
    if (!this.data.tasks.length) {
      this.setData({ tasksState: 'loading', tasksMessage: '' })
    }
    try {
      const page = await mipTasksModule.query.listTasks(undefined, 4, force)
      const tasks = page.items.map(taskView)
      this.setData({
        tasksState: tasks.length ? 'ready' : 'empty',
        tasks,
        tasksMessage: '',
      })
    }
    catch {
      this.setData({
        tasksState: this.data.tasks.length ? 'ready' : 'error',
        tasksMessage: '请稍后重试。',
      })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipGrowthModule.listEntries(this.data.nextCursor, 20)
      this.setData({
        entries: [...this.data.entries, ...page.items.map(entryView)],
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      this.setData({ message: '更多成长记录加载失败。' })
    }
    finally {
      this.setData({ loadingMore: false })
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

  renewMembership() {
    caseNavigateTo({ url: '/pages/membership/index?source=growth-renew' })
  },

  onShareAppMessage() {
    const invitation = this.shareInvitationToken
      ? `&invitationToken=${encodeURIComponent(this.shareInvitationToken)}`
      : ''
    return {
      title: 'MIP 会员方案',
      path: `/pages/membership/index?source=growth-share${invitation}`,
    }
  },
})
