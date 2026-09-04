import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createMipTasksCloudbaseGateway } from './cloudbase-gateway'
import { createMipTasksModule } from './module'

const mipTasksGateway = createMipTasksCloudbaseGateway()
export const mipTasksModule = createMipTasksModule(mipTasksGateway)

registerMipLocalUserCache(() => mipTasksModule.invalidate())
