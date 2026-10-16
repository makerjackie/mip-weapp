import { prepareApp } from './bootstrap'
import { isTestEnvironment, runtimeConfig } from './config/runtime'
import { mipCheckInResumeStore } from './modules/mip-events/client'
import { mipIdentityModule } from './modules/mip-identity/client'
import { registerMipLocalUserCache } from './modules/mip-identity/local-session'
import { mipGlobalAccessGuard } from './modules/mip-identity/runtime'
import { mipPopupMessagePresenter } from './modules/mip-messaging/client'
import { createPopupForegroundCoordinator } from './modules/mip-messaging/popup'
import { profileInterestMutations } from './modules/mip-opportunities/client'
import { clearLoadingDiagnostics, getLoadingDiagnostics } from './platform/cloudbase/loading-diagnostics'
import { clearCloudMediaCache } from './platform/storage/cloud-media'

const popupForeground = createPopupForegroundCoordinator(
  mipIdentityModule,
  mipPopupMessagePresenter,
)
registerMipLocalUserCache(() => popupForeground.invalidate())
registerMipLocalUserCache(clearCloudMediaCache)
registerMipLocalUserCache(clearLoadingDiagnostics)

let launchRestore: Promise<ReturnType<typeof mipGlobalAccessGuard.ensureLaunch>> | undefined
let launchRestoreConsumed = false

const freeEventRuntimeAcceptanceStorageKey = 'mip:internal:free-event-runtime-acceptance:v1'
// MIW-119：支付模式与目录 stage 不再烘焙进 bundle，验收握手只锚定
// build/env/mode——stage 与支付模式的安全断言由构建护栏与函数侧 env 校验承担。
const runtimeAcceptance = Object.freeze({
  buildSha: __BUILD_SHA__,
  cloudbaseEnvId: runtimeConfig.cloudbase.envId,
  cloudbaseMode: runtimeConfig.cloudbase.mode,
})

App({
  getLoadingDiagnostics,
  clearLoadingDiagnostics,
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
    if (isTestEnvironment()) {
      // 测试包明确提示当前环境，避免把测试数据当生产数据。
      wx.showToast({ title: '当前为测试环境', icon: 'none', duration: 3000 })
    }
    mipCheckInResumeStore.prune()
    launchRestore = mipGlobalAccessGuard.restore(options)
    void launchRestore.catch(() => undefined)
    launchRestoreConsumed = false
  },

  onShow(options) {
    mipCheckInResumeStore.prune()
    const restore = !launchRestoreConsumed && launchRestore
      ? (launchRestoreConsumed = true, launchRestore)
      : mipGlobalAccessGuard.restore(options)
    void restore.then((result) => {
      if (result !== 'READY') {
        return
      }
      const snapshot = mipIdentityModule.peekSnapshot()
      if (snapshot?.authenticated && snapshot.agreements.every(item => item.accepted)) {
        void profileInterestMutations.flush()
      }
      if (!mipGlobalAccessGuard.isPublicTarget(options)) {
        void popupForeground.onShow()
      }
    }).catch(() => undefined)
  },

  onHide() {
    popupForeground.onHide()
  },
})
