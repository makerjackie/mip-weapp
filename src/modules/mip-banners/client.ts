import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createMipBannerCloudbaseGateway } from './cloudbase-gateway'
import { createMipBannerModule } from './module'

const mipBannerGateway = createMipBannerCloudbaseGateway()
export const mipBannerModule = createMipBannerModule(mipBannerGateway)

registerMipLocalUserCache(() => mipBannerModule.invalidate())
