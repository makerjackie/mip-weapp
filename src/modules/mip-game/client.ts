import { createMipGameCloudbaseGateway } from './cloudbase-gateway'
import { createMipGameModule } from './module'

export const mipGameGateway = createMipGameCloudbaseGateway()
export const mipGameModule = createMipGameModule(mipGameGateway)
