import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { mipCommerceModule } from '../mip-commerce/client'
import { createCloudbaseMipKnowledgeGateway } from './cloudbase-gateway'
import { createMipKnowledgeModule } from './module'

const gateway = createCloudbaseMipKnowledgeGateway({
  communityFunctionName: runtimeConfig.cloudbase.communityFunctionName,
  commerceFunctionName: runtimeConfig.cloudbase.commerceFunctionName,
  requireCloudClient,
  resolveMedia: resolveCloudFileUrls,
})

export const mipKnowledgeModule = createMipKnowledgeModule(
  gateway,
  { payOrder: orderId => mipCommerceModule.payOrder(orderId) },
  { paymentEnabled: runtimeConfig.paymentMode !== 'disabled' },
)
