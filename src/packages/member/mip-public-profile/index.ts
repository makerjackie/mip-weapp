import type { CooperationCardId, SuperCaseId } from '../../../modules/mip'
import type { CommunityReportIntent, ReportCategory } from '../../../modules/mip-community'
import type { IdentityAccessSnapshot } from '../../../modules/mip-identity'
import type {
  ProfileInfluenceSummary,
  ProfileInterestMutationSnapshot,
  PublicPerson,
  PublicProfileCooperationCard,
  PublicProfileOpportunity,
  PublicProfileSuperCase,
} from '../../../modules/mip-opportunities'
import { badgeArtUrl } from '../../../config/mip-badge-art'
import { cooperationRoles } from '../../../config/mip-catalogs'
import { superCaseModule } from '../../../modules/mip-cases'
import {
  createCommunityReportIntent,
  mipCommunityModule,
  reportCategoryOptions,
} from '../../../modules/mip-community'
import { cooperationModule } from '../../../modules/mip-cooperation'
import { evaluateAccess, mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { careerIdentityOptions } from '../../../modules/mip-identity/profile-options'
import { opportunityModule, profileInterestMutations } from '../../../modules/mip-opportunities'
import { createMutationKey } from '../../../modules/mip-opportunities/validation'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { showIdentityUnlockModal } from '../../../shared/identity-unlock'

type ProfileAction = 'interest' | 'block' | 'report'
type AccessActionState = 'loading' | 'ready' | 'access' | 'error'
type ProfileSection = 'cooperation' | 'cases' | 'opportunities'
// journey-review C1 终审（2026-09-21）档案互动条角色门禁：
// active = 玩家（功能态）；hidden = 嘉宾（整条不渲染）；locked = 普通用户（可见，点击弹解锁）；
// pending = 初始未定态（身份快照未 resolve 前整条不渲染，避免嘉宾先见条后消失的闪烁）。
type InteractionBarMode = 'pending' | 'active' | 'hidden' | 'locked'

interface PublicProfileView extends PublicPerson {
  displayName: string
  kindLabel: string
  identityDetailText: string
  primaryCompanyLine: string
  companies: NonNullable<PublicPerson['companies']>
  organizations: NonNullable<PublicPerson['organizations']>
  abilities: NonNullable<PublicPerson['abilities']>
  badges: NonNullable<PublicPerson['badges']>
  badgeArtFallbackUrls: Record<string, string>
  branchText: string
}

interface CooperationCardView extends PublicProfileCooperationCard { roleName: string }
interface SuperCaseView extends PublicProfileSuperCase { publishedText: string }

function monthText(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? `${date.getFullYear()}年 ${date.getMonth() + 1}月`
    : ''
}

function presentProfile(profile: PublicPerson): PublicProfileView {
  const careerIdentity = careerIdentityOptions.find(option => option.value === profile.careerIdentityKey)?.label || ''
  const gender = profile.gender === 'MALE' ? '男' : profile.gender === 'FEMALE' ? '女' : ''
  const company = profile.companies?.[0]
  return {
    ...profile,
    displayName: profile.realName || profile.nickname || 'MIP 用户',
    kindLabel: profile.userKind === 'PLAYER' ? '玩家' : '嘉宾',
    identityDetailText: [gender, careerIdentity].filter(Boolean).join(' · '),
    primaryCompanyLine: company ? [company.name, company.role].filter(Boolean).join(' · ') : '',
    companies: profile.companies || [],
    organizations: profile.organizations || [],
    abilities: profile.abilities || [],
    badges: profile.badges || [],
    badgeArtFallbackUrls: Object.fromEntries((profile.badges || []).map(badge => [
      badge.id,
      badgeArtUrl(badge.imageUrl, badge.key, badge.name),
    ])),
    branchText: profile.primaryBranch
      ? [profile.primaryBranch.cityName, profile.primaryBranch.name].filter(Boolean).join(' · ')
      : '',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'blocked',
    profileRef: '',
    profile: null as PublicProfileView | null,
    cooperationCards: [] as CooperationCardView[],
    superCases: [] as SuperCaseView[],
    opportunities: [] as PublicProfileOpportunity[],
    influence: null as ProfileInfluenceSummary | null,
    interestActive: false,
    interestState: 'idle' as 'idle' | 'loading' | 'ready' | 'access' | 'syncing' | 'error',
    interestMessage: '',
    safetyState: 'idle' as 'idle' | 'loading' | 'ready' | 'access' | 'processing' | 'reported' | 'error',
    safetyMessage: '',
    canRetryReport: false,
    accessToken: '',
    isSelf: false,
    activeSection: 'cooperation' as ProfileSection,
    deletingId: '',
    message: '',
    // figma 1769_38059/2058_12247/2704_13454 合作卡档案还原态开关，fixture 专用；
    // 生产保持 stats+tabs+列表布局（mip-public-profile 测试 pin）。
    figmaLayout: false,
    interactionBar: 'pending' as InteractionBarMode,
  },
  pendingAction: '' as ProfileAction | '',
  reportIntent: null as CommunityReportIntent | null,
  visitKey: '',
  safetyActionBusy: false,
  influenceRequest: 0,
  profileRequest: 0,
  stopInterestSubscription: null as (() => void) | null,

  onLoad(query: Record<string, string | undefined>) {
    this.reportIntent = null
    this.visitKey = createMutationKey('profile-visit')
    const profileRef = String(query.profileRef || '')
    const scene = String(query.scene || '')
    this.setData({ profileRef })
    if (profileRef) {
      void this.loadProfile()
      return
    }
    void this.resolveScene(scene)
  },

  async resolveScene(scene: string) {
    try {
      const resolved = await mipIdentityModule.resolveProfileCardScene(scene)
      this.setData({ profileRef: resolved.profileRef })
      await this.loadProfile()
    }
    catch {
      this.setData({ state: 'error', message: '名片信息无效或已不可见。' })
    }
  },

  onShow() {
    if (this.data.profile) {
      void this.loadProfile()
    }
    const resumed = mipIdentityModule.consumePendingResume()
    if (resumed?.action === 'INTERACT' && this.pendingAction) {
      const action = this.pendingAction
      this.pendingAction = ''
      void this.runProfileAction(action)
    }
  },

  onUnload() {
    this.profileRequest += 1
    this.stopInterestSubscription?.()
    this.stopInterestSubscription = null
  },

  async loadProfile() {
    if (!this.data.profileRef) {
      this.setData({ state: 'error', message: '档案信息不完整。' })
      return
    }
    if (!this.data.profile) {
      this.setData({ state: 'loading', message: '' })
    }
    const request = ++this.profileRequest
    try {
      const aggregate = await opportunityModule.getPublicProfile(this.data.profileRef)
      if (request !== this.profileRequest) {
        return
      }
      const interest = profileInterestMutations.mergeServer(
        aggregate.profile.profileRef,
        aggregate.interestActive,
      )
      this.observeInterest(aggregate.profile.profileRef)
      this.setData({
        state: 'ready',
        profile: presentProfile(aggregate.profile),
        cooperationCards: aggregate.cooperationCards.map(card => ({
          ...card,
          roleName: cooperationRoles.find(role => role.key === card.roleKey)?.name || card.roleKey,
        })),
        superCases: aggregate.superCases.map(item => ({
          ...item,
          publishedText: monthText(item.publishedAt),
        })),
        opportunities: aggregate.opportunities,
        influence: aggregate.influence || null,
        interestActive: interest.active,
        interestState: interest.pending ? 'syncing' : 'ready',
        isSelf: aggregate.profile.isSelf,
        message: '',
      })
      wx.setNavigationBarTitle({ title: `${aggregate.profile.userKind === 'PLAYER' ? '玩家' : '嘉宾'}档案` })
      if (!aggregate.profile.isSelf) {
        void opportunityModule.recordProfileVisit(this.data.profileRef, this.visitKey).catch(() => undefined)
      }
      await this.resolveInteractionBar()
    }
    catch (error) {
      if (request !== this.profileRequest) {
        return
      }
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '公开档案加载失败。',
      })
    }
  },

  // C1 终审矩阵：普通用户（INTERACT 未就绪）可见可点但弹解锁；嘉宾（就绪且无有效会员权益）
  // 整条隐藏；玩家功能态。快照不可得时按普通用户处理，点击路径会再次核对。
  async resolveInteractionBar() {
    const snapshot = mipIdentityModule.peekSnapshot()
      || await mipIdentityModule.loadSnapshot().catch(() => null)
    this.applyInteractionBarMode(snapshot)
  },

  applyInteractionBarMode(snapshot: IdentityAccessSnapshot | null | undefined) {
    if (!snapshot || !evaluateAccess(snapshot, {
      action: 'INTERACT',
      source: { navigation: 'navigateBack' },
    }).ready) {
      this.setData({ interactionBar: 'locked' })
      return
    }
    this.setData({ interactionBar: snapshot.membership.kind === 'PLAYER' ? 'active' : 'hidden' })
  },

  observeInterest(profileRef: string) {
    this.stopInterestSubscription?.()
    this.stopInterestSubscription = profileInterestMutations.subscribe(profileRef, (interest) => {
      if (profileRef !== this.data.profileRef) {
        return
      }
      const wasPending = this.data.interestState === 'syncing'
      this.applyInterest(interest)
      if (wasPending && !interest.pending && !interest.error) {
        void this.refreshInfluence()
      }
      if (interest.error) {
        wx.showToast({ title: interest.error.message, icon: 'none' })
      }
    })
  },

  async refreshInfluence() {
    const request = ++this.influenceRequest
    try {
      const aggregate = await opportunityModule.getPublicProfile(this.data.profileRef)
      if (request === this.influenceRequest && this.data.interestState !== 'syncing') {
        this.setData({ influence: aggregate.influence || null })
      }
    }
    catch { /* An optional counter refresh must not hide the loaded profile. */ }
  },

  applyInterest(interest: ProfileInterestMutationSnapshot) {
    this.setData({
      interestActive: interest.active,
      interestState: interest.error ? 'error' : interest.pending ? 'syncing' : 'ready',
      interestMessage: interest.error?.message || '',
    })
  },

  hasCachedInterestAccess() {
    const snapshot = mipIdentityModule.peekSnapshot()
    return Boolean(snapshot && evaluateAccess(snapshot, {
      action: 'INTERACT',
      source: { navigation: 'navigateBack' },
    }).ready)
  },

  openOwnInfluence(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.isSelf) {
      return
    }
    const category = String(event.currentTarget.dataset.category || '')
    if (!['GUEST', 'INTERACTION', 'ACTIVE_INTEREST', 'VISITOR'].includes(category)) {
      return
    }
    if (category === 'ACTIVE_INTEREST') {
      caseNavigateTo({ url: `/packages/member/mip-profile-interests/index?profileRef=${encodeURIComponent(this.data.profileRef)}` })
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-received/index?scope=influence&category=${category}`,
    })
  },

  setActionState(action: ProfileAction, state: AccessActionState, message = '') {
    if (action === 'interest') {
      this.setData({ interestState: state, interestMessage: message })
      return
    }
    this.setData({ safetyState: state, safetyMessage: message })
  },

  async ensureActionAccess(action: ProfileAction) {
    this.setActionState(action, 'loading')
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        // J2-04（C1 终审）：普通用户点击档案互动条一律弹原生解锁提示，
        // 确定取消均停留，不再进入身份资料流程（资料型入口保留给举报/屏蔽）。
        if (action === 'interest') {
          this.pendingAction = ''
          this.applyInteractionBarMode(session.snapshot)
          this.setActionState(action, 'ready')
          await showIdentityUnlockModal().catch(() => undefined)
          return false
        }
        this.pendingAction = action
        this.setData({ accessToken: session.token })
        this.setActionState(action, 'access')
        return false
      }
      if (action === 'interest') {
        this.applyInteractionBarMode(session.snapshot)
        this.setData({ accessToken: '' })
        this.setActionState(action, 'ready')
        return !this.data.isSelf
      }
      const relationship = await mipCommunityModule.relationship(this.data.profileRef)
      this.setData({ accessToken: '', isSelf: relationship.isSelf })
      this.setActionState(action, 'ready')
      return !relationship.isSelf
    }
    catch (error) {
      this.setActionState(
        action,
        'error',
        error instanceof Error ? error.message : '暂时无法确认操作状态。',
      )
      if (action !== 'interest') {
        this.setData({ canRetryReport: false })
      }
      return false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  changeSection(event: WechatMiniprogram.TouchEvent) {
    const activeSection = String(event.currentTarget.dataset.section || '') as ProfileSection
    if (!['cooperation', 'cases', 'opportunities'].includes(activeSection)
      || activeSection === this.data.activeSection) {
      return
    }
    this.setData({ activeSection })
  },

  toggleInterest() {
    if (this.data.isSelf || this.data.interestState === 'loading') {
      return
    }
    // C1 终审：普通用户点击「我感兴趣」弹原生解锁窗，确定取消均停留（J2-03 → J2-04）。
    if (this.data.interactionBar === 'locked') {
      void showIdentityUnlockModal().catch(() => undefined)
      return
    }
    void this.runProfileAction('interest')
  },

  // J4-02b：玩家查看公开的感兴趣名单，普通用户保留原生解锁提示。
  openInterestList() {
    if (this.data.isSelf) {
      return
    }
    if (this.data.interactionBar === 'locked') {
      void showIdentityUnlockModal().catch(() => undefined)
      return
    }
    if (this.data.interactionBar !== 'active' || !this.data.influence) {
      return
    }
    caseNavigateTo({ url: `/packages/member/mip-profile-interests/index?profileRef=${encodeURIComponent(this.data.profileRef)}` })
  },

  async openProfileMore() {
    if (this.data.isSelf || this.safetyActionBusy) {
      return
    }
    const selected = await wx.showActionSheet({ itemList: ['举报', '屏蔽'] }).catch(() => null)
    if (selected?.tapIndex === 0) {
      this.reportProfile()
    }
    else if (selected?.tapIndex === 1) {
      this.blockProfile()
    }
  },

  blockProfile() {
    void this.runProfileAction('block')
  },

  reportProfile() {
    void this.runProfileAction('report')
  },

  async runProfileAction(action: ProfileAction) {
    if (action !== 'interest' && this.safetyActionBusy) {
      return
    }
    if (action !== 'interest') {
      this.safetyActionBusy = true
    }
    this.pendingAction = action
    try {
      if (action === 'interest' && this.hasCachedInterestAccess()) {
        this.pendingAction = ''
        this.updateInterest()
        return
      }
      if (!await this.ensureActionAccess(action)) {
        return
      }
      this.pendingAction = ''
      if (action === 'interest') {
        this.updateInterest()
        return
      }
      if (action === 'block') {
        await this.confirmBlock()
        return
      }
      await this.submitReport()
    }
    finally {
      if (action !== 'interest') {
        this.safetyActionBusy = false
      }
    }
  },

  updateInterest() {
    const active = !this.data.interestActive
    const interest = profileInterestMutations.mutate({
      targetProfileRef: this.data.profileRef,
      active,
      currentActive: this.data.interestActive,
      source: { sourceType: 'PROFILE', profileRef: this.data.profileRef },
    })
    this.applyInterest(interest)
  },

  async confirmBlock() {
    const confirmed = await wx.showModal({
      title: '屏蔽用户',
      content: '屏蔽后，你们将无法查看对方的公开档案，相关公开列表也会隐藏对方。屏蔽不会通知对方。',
      confirmText: '确认屏蔽',
      confirmColor: '#FF4D5E',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ safetyState: 'processing', safetyMessage: '' })
    try {
      await mipCommunityModule.block(this.data.profileRef)
      this.setData({
        state: 'blocked',
        profile: null,
        cooperationCards: [],
        superCases: [],
        opportunities: [],
        safetyState: 'ready',
      })
      wx.showToast({ title: '已屏蔽', icon: 'success' })
    }
    catch (error) {
      this.setData({
        safetyState: 'error',
        safetyMessage: error instanceof Error ? error.message : '屏蔽失败，请重试。',
        canRetryReport: false,
      })
    }
  },

  async submitReport() {
    if (this.reportIntent) {
      await this.sendReportIntent()
      return
    }
    const selected = await wx.showActionSheet({
      itemList: reportCategoryOptions.map(item => item.label),
    }).catch(() => null)
    if (!selected || selected.tapIndex < 0 || selected.tapIndex >= reportCategoryOptions.length) {
      this.reportIntent = null
      return
    }
    const category = reportCategoryOptions[selected.tapIndex].value as ReportCategory
    const description = await wx.showModal({
      title: '举报说明',
      content: '',
      editable: true,
      placeholderText: '仅运营人员可见，可选，最多 300 字',
      confirmText: '提交',
    }).catch(() => null)
    if (!description?.confirm) {
      this.reportIntent = null
      return
    }
    const text = String(description.content || '').trim()
    if (text.length > 300) {
      this.setData({ safetyState: 'error', safetyMessage: '补充说明最多 300 字。' })
      return
    }
    this.reportIntent = createCommunityReportIntent(this.data.profileRef, category, text)
    await this.sendReportIntent()
  },

  async sendReportIntent() {
    const intent = this.reportIntent
    if (!intent) {
      return
    }
    this.setData({ safetyState: 'processing', safetyMessage: '', canRetryReport: false })
    try {
      await mipCommunityModule.report(
        intent.profileRef,
        intent.category,
        intent.description,
        intent.requestId,
      )
      this.reportIntent = null
      this.setData({ safetyState: 'reported', safetyMessage: '举报已提交。', canRetryReport: false })
      wx.showToast({ title: '已提交', icon: 'success' })
    }
    catch (error) {
      this.setData({
        safetyState: 'error',
        safetyMessage: error instanceof Error ? error.message : '举报提交失败，请重试。',
        canRetryReport: true,
      })
    }
  },

  retryReport() {
    if (this.reportIntent) {
      void this.sendReportIntent()
    }
  },

  openCooperationCard(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  // journey-review C5（2026-09-21 拍板）：本人档案合作卡/超级案例 tab 长按卡片（原生 longpress 手势）删除——
  // 微信原生确认弹窗「删除后将无法恢复，是否删除？」（删除警示红），确认后卡片移除 +
  // toast「已删除」（1.8s）；取消停留原页。列表摘要不带 version，先取详情再按乐观锁归档。
  async deleteOwnCooperationCard(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.isSelf || this.data.deletingId) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const card = this.data.cooperationCards.find(item => item.id === id)
    if (!card) {
      return
    }
    const cardId = card.id as CooperationCardId
    this.setData({ deletingId: id })
    const confirmation = await wx.showModal({
      title: '删除提示',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ deletingId: '' })
      return
    }
    try {
      const detail = await cooperationModule.get(cardId)
      await cooperationModule.archive(cardId, detail.version)
      this.profileRequest += 1
      this.setData({
        cooperationCards: this.data.cooperationCards.filter(item => item.id !== id),
        deletingId: '',
      })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1800 })
    }
    catch (error) {
      this.setData({ deletingId: '' })
      wx.showToast({ title: error instanceof Error ? error.message : '合作卡删除失败，请重试。', icon: 'none' })
    }
  },

  async deleteOwnSuperCase(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.isSelf || this.data.deletingId) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.superCases.find(entry => entry.id === id)
    if (!item) {
      return
    }
    const caseId = item.id as SuperCaseId
    this.setData({ deletingId: id })
    const confirmation = await wx.showModal({
      title: '删除提示',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ deletingId: '' })
      return
    }
    try {
      const detail = await superCaseModule.get(caseId)
      await superCaseModule.archive(caseId, detail.version)
      this.profileRequest += 1
      // 时间轴节点/月份标签是展示层，随数据收缩自然消失，无需特判。
      this.setData({
        superCases: this.data.superCases.filter(entry => entry.id !== id),
        deletingId: '',
      })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1800 })
    }
    catch (error) {
      this.setData({ deletingId: '' })
      wx.showToast({ title: error instanceof Error ? error.message : '案例删除失败，请重试。', icon: 'none' })
    }
  },

  openSuperCase(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-cases/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openOpportunity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  // journey-review J6-03 落点①：相关机会 tab 长按删除，与同页合作卡/超级案例 C5 流同口径
  // （原生弹窗 + 乐观锁归档 + toast「已删除」1.8s）；服务端 action 未上线前失败走 toast 兜底。
  async deleteOwnOpportunity(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.isSelf || this.data.deletingId) {
      return
    }
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.opportunities.find(entry => entry.id === id)
    if (!item) {
      return
    }
    this.setData({ deletingId: id })
    const confirmation = await wx.showModal({
      title: '删除提示',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ deletingId: '' })
      return
    }
    try {
      const detail = await opportunityModule.get(item.id)
      await opportunityModule.remove(item.id, detail.version)
      this.profileRequest += 1
      this.setData({
        opportunities: this.data.opportunities.filter(entry => entry.id !== id),
        deletingId: '',
      })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1800 })
    }
    catch (error) {
      this.setData({ deletingId: '' })
      wx.showToast({ title: error instanceof Error ? error.message : '机会删除失败，请重试。', icon: 'none' })
    }
  },

  openBlockedList() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },
})
