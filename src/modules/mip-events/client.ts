import { cloudbaseMipEventsGateway } from './cloudbase-gateway'
import { createMipEventsModule } from './module'

export const mipEventsModule = createMipEventsModule(cloudbaseMipEventsGateway)
