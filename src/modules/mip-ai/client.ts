import { cloudbaseMipAiGateway } from './cloudbase-gateway'
import { createMipAiModule } from './module'
import { createVoiceNoteFlow } from './voice-note'

export const mipAiModule = createMipAiModule(cloudbaseMipAiGateway)

export const mipVoiceNoteFlow = createVoiceNoteFlow(cloudbaseMipAiGateway)
