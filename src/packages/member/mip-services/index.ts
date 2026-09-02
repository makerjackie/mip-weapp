import type { ProtectedActionKey } from '../../../modules/mip-identity'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../platform/navigation/client'

const PAGE_ROUTE = 'packages/member/mip-services/index'

Page({
  data: {
    state: 'ready' as const,
    notificationUnreadCount: 0,
    message: '',
  },
  resumeDestination: '',

  onShow() {
    const resume = mipIdentityModule.consumePendingResume(PAGE_ROUTE)
    if (resume && this.resumeDestination) {
      const destination = this.resumeDestination
      this.resumeDestination = ''
      caseNavigateTo({ url: destination })
      return
    }
    this.resumeDestination = ''
    void this.refreshNotificationUnread()
  },

  async refreshNotificationUnread() {
    const cached = mipMessagingModule.peekUnreadCount()
    if (cached !== undefined) {
      this.setData({ notificationUnreadCount: cached })
    }
    try {
      const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
      if (!snapshot.authenticated) {
        this.setData({ notificationUnreadCount: 0 })
        return
      }
      const notificationUnreadCount = await mipMessagingModule.refreshUnreadCount()
      this.setData({ notificationUnreadCount })
    }
    catch {
      if (cached === undefined) {
        this.setData({ notificationUnreadCount: 0 })
      }
    }
  },

  async openProtected(destination: string, action: ProtectedActionKey) {
    this.resumeDestination = destination
    this.setData({ message: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action,
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        this.resumeDestination = ''
        caseNavigateTo({ url: destination })
        return
      }
      caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    }
    catch {
      this.resumeDestination = ''
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  openGame() { void this.openProtected('/packages/member/mip-game/index', 'VIEW_RESTRICTED_PROFILE') },
  openHeartHistory() { void this.openProtected('/packages/member/mip-hearts/index', 'INTERACT') },
  openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') },
  openDigitalAvatar() { void this.openProtected('/packages/member/mip-avatar/index', 'EDIT_PROFILE') },
  openAiDrafts() { void this.openProtected('/packages/member/mip-ai/index', 'EDIT_PROFILE') },
  openMatching() { void this.openProtected('/packages/member/mip-opportunity-matching/index', 'INTERACT') },
  openOpportunitySettings() { void this.openProtected('/packages/member/mip-opportunity-settings/index', 'INTERACT') },
  openBranches() { caseNavigateTo({ url: '/packages/member/mip-branches/index' }) },
  openBenefits() { caseNavigateTo({ url: '/packages/member/benefits/index' }) },
  openHelp() { caseNavigateTo({ url: '/packages/member/help/index' }) },
  openAbout() { caseNavigateTo({ url: '/packages/member/about/index' }) },
})
