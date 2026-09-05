import { mipCommerceModule } from '../mip-commerce/client'
import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createCheckInResumeStore } from './check-in-resume'
import { cloudbaseMipEventsGateway } from './cloudbase-gateway'
import { createMipEventsModule } from './module'
import { createRegistrationDraftStore } from './registration-draft'

export const mipEventsModule = createMipEventsModule(cloudbaseMipEventsGateway, {
  submitRefund: refundId => mipCommerceModule.submitRefund(refundId as import('../mip-commerce').RefundId),
})

export const mipCheckInResumeStore = createCheckInResumeStore({
  read: key => wx.getStorageSync(key) as unknown,
  write: (key, value) => wx.setStorageSync(key, value),
  clear: key => wx.removeStorageSync(key),
}, () => Date.now(), {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

registerMipLocalUserCache(() => mipEventsModule.invalidate())
registerMipLocalUserCache(() => mipCheckInResumeStore.clear())

export const mipRegistrationDraftStore = createRegistrationDraftStore({
  read: key => wx.getStorageSync(key) as unknown,
  write: (key, value) => wx.setStorageSync(key, value),
  clear: key => wx.removeStorageSync(key),
})
registerMipLocalUserCache(() => mipRegistrationDraftStore.clear())
