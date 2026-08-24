import { cloudbaseMipGrowthGateway } from './cloudbase-gateway'
import { createMipGrowthModule } from './module'

export const mipGrowthModule = createMipGrowthModule(cloudbaseMipGrowthGateway)
