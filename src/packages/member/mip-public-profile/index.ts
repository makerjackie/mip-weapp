import type { CommunityReportIntent, ReportCategory } from '../../../modules/mip-community'
import type { ProfileOrganization, PublicMipProfile } from '../../../modules/mip-identity'
import {
  createCommunityReportIntent,
  mipCommunityModule,
  reportCategoryOptions,
} from '../../../modules/mip-community'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

type SafetyAction = 'block' | 'report'

interface PublicProfileView extends PublicMipProfile {
  displayName: string
  kindLabel: string
  companies: ProfileOrganization[]
  organizations: ProfileOrganization[]
  abilities: Array<{ label: string }>
  branchText: string
}

function presentProfile(profile: PublicMipProfile): PublicProfileView {
  return {
    ...profile,
    displayName: profile.nickname || 'MIP 用户',
    kindLabel: profile.userKind === 'PLAYER' ? '玩家' : profile.userKind === 'GUEST' ? '嘉宾' : '',
    companies: profile.companies || [],
    organizations: profile.organizations || [],
    abilities: profile.abilities || [],
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
    safetyState: 'idle' as 'idle' | 'loading' | 'ready' | 'access' | 'processing' | 'reported' | 'error',
    safetyMessage: '',
    canRetryReport: false,
    accessToken: '',
    isSelf: false,
    message: '',
  },
  pendingSafetyAction: '' as SafetyAction | '',
  reportIntent: null as CommunityReportIntent | null,

  onLoad(query: Record<string, string | undefined>) {
    this.reportIntent = null
    this.setData({ profileRef: String(query.profileRef || '') })
    void this.loadProfile()
  },

  onShow() {
    const resumed = mipIdentityModule.consumePendingResume()
    if (resumed?.action === 'INTERACT' && this.pendingSafetyAction) {
      const action = this.pendingSafetyAction
      this.pendingSafetyAction = ''
      void this.runSafetyAction(action)
    }
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
      const profile = await mipIdentityModule.getPublicProfile(this.data.profileRef)
      this.setData({
        state: 'ready',
        profile: presentProfile(profile),
        isSelf: profile.isSelf,
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '公开档案加载失败。',
      })
    }
  },

  async ensureSafetyAccess(action: SafetyAction) {
    this.setData({ safetyState: 'loading', safetyMessage: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        this.pendingSafetyAction = action
        this.setData({ safetyState: 'access', accessToken: session.token })
        return false
      }
      const relationship = await mipCommunityModule.relationship(this.data.profileRef)
      this.setData({
        safetyState: 'ready',
        accessToken: '',
        isSelf: relationship.isSelf,
      })
      return !relationship.isSelf
    }
    catch (error) {
      this.setData({
        safetyState: 'error',
        safetyMessage: error instanceof Error ? error.message : '暂时无法确认操作状态。',
        canRetryReport: false,
      })
      return false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  retrySafetyAction() {
    if (this.pendingSafetyAction) {
      void this.runSafetyAction(this.pendingSafetyAction)
    }
  },

  blockProfile() {
    void this.runSafetyAction('block')
  },

  reportProfile() {
    void this.runSafetyAction('report')
  },

  async runSafetyAction(action: SafetyAction) {
    this.pendingSafetyAction = action
    if (!await this.ensureSafetyAccess(action)) {
      return
    }
    this.pendingSafetyAction = ''
    if (action === 'block') {
      await this.confirmBlock()
      return
    }
    await this.submitReport()
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
      this.setData({ state: 'blocked', profile: null, safetyState: 'ready' })
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

  openBlockedList() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },
})
