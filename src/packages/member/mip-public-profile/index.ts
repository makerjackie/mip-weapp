import type { CommunityReportIntent, ReportCategory } from '../../../modules/mip-community'
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
import {
  createCommunityReportIntent,
  mipCommunityModule,
  reportCategoryOptions,
} from '../../../modules/mip-community'
import { evaluateAccess, mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { careerIdentityOptions } from '../../../modules/mip-identity/profile-options'
import { opportunityModule, profileInterestMutations } from '../../../modules/mip-opportunities'
import { createMutationKey } from '../../../modules/mip-opportunities/validation'
import { caseNavigateTo } from '../../../platform/navigation/client'

type ProfileAction = 'interest' | 'block' | 'report'
type AccessActionState = 'loading' | 'ready' | 'access' | 'error'
type ProfileSection = 'cooperation' | 'cases' | 'opportunities'

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
    message: '',
  },
  pendingAction: '' as ProfileAction | '',
  reportIntent: null as CommunityReportIntent | null,
  visitKey: '',
  safetyActionBusy: false,
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
    const resumed = mipIdentityModule.consumePendingResume()
    if (resumed?.action === 'INTERACT' && this.pendingAction) {
      const action = this.pendingAction
      this.pendingAction = ''
      void this.runProfileAction(action)
    }
  },

  onUnload() {
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
    try {
      const aggregate = await opportunityModule.getPublicProfile(this.data.profileRef)
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
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '公开档案加载失败。',
      })
    }
  },

  observeInterest(profileRef: string) {
    this.stopInterestSubscription?.()
    this.stopInterestSubscription = profileInterestMutations.subscribe(profileRef, (interest) => {
      if (profileRef !== this.data.profileRef) {
        return
      }
      this.applyInterest(interest)
      if (interest.error) {
        wx.showToast({ title: interest.error.message, icon: 'none' })
      }
    })
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
        this.pendingAction = action
        this.setData({ accessToken: session.token })
        this.setActionState(action, 'access')
        return false
      }
      if (action === 'interest') {
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
    if (this.data.isSelf || ['loading', 'syncing'].includes(this.data.interestState)) {
      return
    }
    void this.runProfileAction('interest')
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
      content: '屏蔽后，你们将无法查看对方的公开档案，相关公开列表也会隐藏对方。',
      confirmText: '确认屏蔽',
      confirmColor: '#E65C5C',
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
      title: '补充说明',
      content: '',
      editable: true,
      placeholderText: '可选，最多 300 字',
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

  openBlockedList() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },
})
