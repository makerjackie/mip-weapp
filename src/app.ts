import { prepareApp } from './bootstrap'
import { runtimeConfig } from './config/runtime'
import { mipCheckInResumeStore } from './modules/mip-events/client'
import { mipIdentityModule } from './modules/mip-identity/client'
import { registerMipLocalUserCache } from './modules/mip-identity/local-session'
import { mipGlobalAccessGuard } from './modules/mip-identity/runtime'
import { mipPopupMessagePresenter } from './modules/mip-messaging/client'
import { createPopupForegroundCoordinator } from './modules/mip-messaging/popup'
import { clearCloudMediaCache } from './platform/storage/cloud-media'

const popupForeground = createPopupForegroundCoordinator(
  mipIdentityModule,
  mipPopupMessagePresenter,
)
registerMipLocalUserCache(() => popupForeground.invalidate())
registerMipLocalUserCache(clearCloudMediaCache)

const freeEventRuntimeAcceptanceStorageKey = 'mip:internal:free-event-runtime-acceptance:v1'
const runtimeAcceptance = Object.freeze({
  buildSha: __BUILD_SHA__,
  catalogStage: runtimeConfig.catalogStage,
  cloudbaseEnvId: runtimeConfig.cloudbase.envId,
  cloudbaseMode: runtimeConfig.cloudbase.mode,
  paymentMode: runtimeConfig.paymentMode,
})

App({
  globalData: {
    runtimeAcceptance: { ...runtimeAcceptance },
  },

  onLaunch(options) {
    // A handshake is valid only when app.js and its loaded common.js come from the same mutation build.
    if (
      __BUILD_SHA__.startsWith('free-event-runtime-')
      && runtimeConfig.buildSha === __BUILD_SHA__
    ) {
      wx.setStorageSync(freeEventRuntimeAcceptanceStorageKey, { ...runtimeAcceptance })
    }
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
