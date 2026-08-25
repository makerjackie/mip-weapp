import {
  createMipBannerCloudbaseGateway,
  createMipBannerMediaCloudbasePort,
} from './cloudbase-gateway'
import { createMipBannerModule } from './module'

export const mipBannerGateway = createMipBannerCloudbaseGateway()
export const mipBannerMediaPort = createMipBannerMediaCloudbasePort()
export const mipBannerModule = createMipBannerModule(mipBannerGateway, mipBannerMediaPort)
