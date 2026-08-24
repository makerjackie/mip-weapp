import { runtimeConfig } from '../../config/runtime'
import { cloudbaseMipMessagingGateway } from './cloudbase-gateway'
import { createMipMessagingModule } from './module'
import { createWechatSubscriptionRequester } from './wechat-subscription'

export const mipMessagingModule = createMipMessagingModule(
  cloudbaseMipMessagingGateway,
  createWechatSubscriptionRequester(runtimeConfig.subscribeTemplatesJson),
)
