import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createMipGameCloudbaseGateway } from './cloudbase-gateway'
import { createMipGameModule } from './module'
import { createBlindBoxPendingDrawStore } from './pending-draw'

export const mipGameGateway = createMipGameCloudbaseGateway()
export const mipGameModule = createMipGameModule(mipGameGateway)
export const mipGamePendingDrawStore = createBlindBoxPendingDrawStore({
  read: key => wx.getStorageSync(key) as unknown,
  write: (key, value) => wx.setStorageSync(key, value),
  clear: key => wx.removeStorageSync(key),
})

registerMipLocalUserCache(() => mipGameModule.invalidate())
