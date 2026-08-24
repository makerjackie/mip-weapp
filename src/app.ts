import { prepareApp } from './bootstrap'
import { mipCheckInResumeStore } from './modules/mip-events/client'
import { mipIdentityModule } from './modules/mip-identity/client'
import { mipGlobalAccessGuard } from './modules/mip-identity/runtime'
import { mipPopupMessagePresenter } from './modules/mip-messaging/client'
import { createPopupForegroundCoordinator } from './modules/mip-messaging/popup'

const popupForeground = createPopupForegroundCoordinator(
  mipIdentityModule,
  mipPopupMessagePresenter,
)

App({
  onLaunch(options) {
    prepareApp()
    mipCheckInResumeStore.prune()
    mipGlobalAccessGuard.ensureLaunch(options)
  },

  onShow(options) {
    mipCheckInResumeStore.prune()
    mipGlobalAccessGuard.ensureLaunch(options)
    void popupForeground.onShow()
  },

  onHide() {
    popupForeground.onHide()
  },
})
