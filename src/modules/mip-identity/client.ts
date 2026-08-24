import { createMipBranchesModule } from '../mip-branches/module'
import { createMipIdentityCloudbaseGateway } from './cloudbase-gateway'
import { createMipIdentityModule } from './module'

export const mipIdentityGateway = createMipIdentityCloudbaseGateway()
export const mipIdentityModule = createMipIdentityModule(mipIdentityGateway)
export const mipBranchesModule = createMipBranchesModule(mipIdentityGateway)
