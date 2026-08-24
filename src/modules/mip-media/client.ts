import { createMipMediaCloudbaseGateway } from './cloudbase-gateway'
import { createMipMediaModule } from './module'

export const mipMediaGateway = createMipMediaCloudbaseGateway()
export const mipMediaModule = createMipMediaModule(mipMediaGateway)
