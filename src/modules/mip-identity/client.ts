import { createMipBranchesModule } from '../mip-branches/module'
import { createMipIdentityCloudbaseGateway } from './cloudbase-gateway'
import { registerMipLocalUserCache } from './local-session'
import {
  createMipIdentityModule,
  MIP_IDENTITY_ACCESS_STORAGE_KEY,
} from './module'

const identityAccessStorage = {
  read: () => wx.getStorageSync(MIP_IDENTITY_ACCESS_STORAGE_KEY) as unknown,
  write: (state: unknown) => wx.setStorageSync(MIP_IDENTITY_ACCESS_STORAGE_KEY, state),
  clear: () => wx.removeStorageSync(MIP_IDENTITY_ACCESS_STORAGE_KEY),
}

export const mipIdentityGateway = createMipIdentityCloudbaseGateway()
export const mipIdentityModule = createMipIdentityModule(mipIdentityGateway, {
  storage: identityAccessStorage,
})
export const mipBranchesModule = createMipBranchesModule(mipIdentityGateway)

registerMipLocalUserCache(() => mipBranchesModule.invalidate())
