import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipLocalSession } from '../../../modules/mip-identity/local-session-client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { caseNavigateTo } from '../../../platform/navigation/client'

// MIW-93：注销入口本轮下线（DEF-07），页面只保留退出登录与账号状态展示；
// 服务端 identity-api 的 account-closure 能力保留（供支持/应急场景），无入口即不可达。
Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'success' | 'error',
    localLogoutState: 'idle' as 'idle' | 'confirming' | 'processing',
    userVersion: 0,
    message: '',
  },

  onLoad() {
    void this.loadAccountState()
  },

  async loadAccountState() {
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (!snapshot.authenticated) {
        mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
        return
      }
      if (snapshot.userStatus === 'CLOSED') {
        this.setData({ state: 'success', userVersion: snapshot.userVersion })
        return
      }
      this.setData({
        state: 'ready',
        userVersion: snapshot.userVersion,
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '账号状态加载失败。',
      })
    }
  },

  openHelp() { caseNavigateTo({ url: '/packages/member/help/index' }) },
  openNotificationSettings() { caseNavigateTo({ url: '/packages/member/mip-opportunity-settings/index' }) },
  openAbout() { caseNavigateTo({ url: '/packages/member/about/index' }) },

  openVisibilitySettings() {
    caseNavigateTo({ url: '/packages/member/mip-visibility-settings/index' })
  },

  // journey-review J5-01：绑定手机是唯一改绑入口（三级页 bind-phone，双路径换绑）。
  openBindPhone() {
    caseNavigateTo({ url: '/packages/member/bind-phone/index' })
  },

  // journey-review J5-03：隐私设置独立成页（两行开关），不再页内分支还原。
  openPrivacySettings() {
    caseNavigateTo({ url: '/packages/member/privacy-settings/index' })
  },

  // 会员协议由后台维护，复用文档阅读页面。
  openMembershipAgreement() {
    caseNavigateTo({ url: '/packages/member/user-agreement/index?document=membership' })
  },

  openBlockedProfiles() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },

  openUserAgreement() {
    caseNavigateTo({ url: '/packages/member/user-agreement/index' })
  },

  openPrivacyPolicy() {
    caseNavigateTo({ url: '/packages/member/privacy-policy/index' })
  },

  async signOutLocally() {
    if (this.data.localLogoutState !== 'idle') {
      return
    }
    this.setData({ localLogoutState: 'confirming', message: '' })
    try {
      const confirmed = await wx.showModal({
        title: '退出登录',
        content: '退出后将清除本机登录状态和用户缓存，不会删除账号或业务记录。',
        confirmText: '退出',
      })
      if (!confirmed?.confirm) {
        return
      }

      this.setData({ localLogoutState: 'processing' })
      mipLocalSession.signOut()
      mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
      wx.showToast({ title: '已退出登录', icon: 'success' })
    }
    catch {
      this.setData({ message: '退出未完成，请重试。' })
    }
    finally {
      this.setData({ localLogoutState: 'idle' })
    }
  },
})
