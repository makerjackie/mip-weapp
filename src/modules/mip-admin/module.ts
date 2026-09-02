import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createMipAdminModule } from './client'
import { cloudbaseMipAdminGateway } from './cloudbase-gateway'
import { createPendingAdminExportStore } from './pending-export'

const pendingExportStore = createPendingAdminExportStore({
  read: key => wx.getStorageSync(key) as unknown,
  write: (key, value) => wx.setStorageSync(key, value),
  clear: key => wx.removeStorageSync(key),
}, () => Date.now(), {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

export const mipAdminModule = createMipAdminModule(cloudbaseMipAdminGateway, { pendingExportStore })

registerMipLocalUserCache(() => mipAdminModule.runtime.invalidate())
