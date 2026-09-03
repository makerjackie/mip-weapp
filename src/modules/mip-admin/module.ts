import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createMipAdminModule } from './client'
import { cloudbaseMipAdminGateway } from './cloudbase-gateway'

export const mipAdminModule = createMipAdminModule(cloudbaseMipAdminGateway)

registerMipLocalUserCache(() => mipAdminModule.runtime.invalidate())
