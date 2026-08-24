import { createMipBannerCloudbaseGateway } from './cloudbase-gateway'
import { createMipBannerModule } from './module'

export const mipBannerGateway = createMipBannerCloudbaseGateway()
export const mipBannerModule = createMipBannerModule(mipBannerGateway)
