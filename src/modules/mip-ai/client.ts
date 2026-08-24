import { cloudbaseMipAiGateway } from './cloudbase-gateway'
import { createMipAiModule } from './module'

export const mipAiModule = createMipAiModule(cloudbaseMipAiGateway)
