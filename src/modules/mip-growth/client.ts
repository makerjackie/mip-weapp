import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { cloudbaseMipGrowthGateway } from './cloudbase-gateway'
import { createMipGrowthModule } from './module'

export const mipGrowthModule = createMipGrowthModule(cloudbaseMipGrowthGateway)

registerMipLocalUserCache(() => mipGrowthModule.invalidate())
