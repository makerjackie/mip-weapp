import { prepareApp } from './bootstrap'
import { runtimeConfig } from './config/runtime'
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
  globalData: {
    runtimeAcceptance: {
      buildSha: runtimeConfig.buildSha,
      catalogStage: runtimeConfig.catalogStage,
      cloudbaseEnvId: runtimeConfig.cloudbase.envId,
      cloudbaseMode: runtimeConfig.cloudbase.mode,
      paymentMode: runtimeConfig.paymentMode,
    },
  },

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
