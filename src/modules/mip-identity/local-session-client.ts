import { mipIdentityModule } from './client'
import { createMipLocalSessionController } from './local-session'

export const mipLocalSession = createMipLocalSessionController(mipIdentityModule, {
  storage: {
    keys: () => wx.getStorageInfoSync().keys,
    remove: key => wx.removeStorageSync(key),
  },
})
