import { prepareApp } from './bootstrap'
import { mipGlobalAccessGuard } from './modules/mip-identity/runtime'

App({
  onLaunch(options) {
    prepareApp()
    mipGlobalAccessGuard.ensureLaunch(options)
  },

  onShow(options) {
    mipGlobalAccessGuard.ensureLaunch(options)
  },
})
