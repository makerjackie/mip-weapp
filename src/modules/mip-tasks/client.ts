import { createMipTasksCloudbaseGateway } from './cloudbase-gateway'
import { createMipTasksModule } from './module'

export const mipTasksGateway = createMipTasksCloudbaseGateway()
export const mipTasksModule = createMipTasksModule(mipTasksGateway)
