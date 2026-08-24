import { createMipAdminModule } from './client'
import { cloudbaseMipAdminGateway } from './cloudbase-gateway'

export const mipAdminModule = createMipAdminModule(cloudbaseMipAdminGateway)
