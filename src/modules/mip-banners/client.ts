import { registerMipLocalUserCache } from '../mip-identity/local-session'
import {
  createMipBannerCloudbaseGateway,
  createMipBannerMediaCloudbasePort,
} from './cloudbase-gateway'
import { createMipBannerModule } from './module'

export const mipBannerGateway = createMipBannerCloudbaseGateway()
export const mipBannerMediaPort = createMipBannerMediaCloudbasePort()
export const mipBannerModule = createMipBannerModule(mipBannerGateway, mipBannerMediaPort)

registerMipLocalUserCache(() => mipBannerModule.invalidate())
