import { createRuntimeConfig } from '@weapp/platform/runtime-config'
import { brand } from './brand'
import { defaults } from './defaults'
import { features } from './features'

export type CloudbaseMode = 'disabled' | 'direct' | 'shared'
export type PaymentMode = 'disabled' | 'test' | 'live'
export type CatalogStage = 'TEST' | 'LIVE'

function paymentMode(value: string): PaymentMode {
  return value === 'test' || value === 'live' ? value : 'disabled'
}

function catalogStage(value: string): CatalogStage {
  return value === 'LIVE' ? 'LIVE' : 'TEST'
}

const baseConfig = createRuntimeConfig({
  appName: __APP_NAME__ || brand.productName,
  appNamespace: __APP_NAMESPACE__ || defaults.appNamespace,
  appVersion: __APP_VERSION__,
  buildSha: __BUILD_SHA__,
  cloudbaseEnvId: __CLOUDBASE_ENV_ID__,
  cloudbaseResourceAppId: __CLOUDBASE_RESOURCE_APP_ID__,
  cloudbaseFunctionName: __MIP_IDENTITY_FUNCTION_NAME__ || defaults.identityFunctionName,
})

const resolvedPaymentMode = paymentMode(__MIP_PAYMENT_MODE__ || defaults.paymentMode)

export const runtimeConfig = {
  appName: baseConfig.app.name,
  appNamespace: baseConfig.app.namespace,
  appVersion: baseConfig.app.version,
  buildSha: baseConfig.app.buildSha,
  brand,
  features,
  cloudbase: {
    envId: baseConfig.cloudbase.envId,
    resourceAppId: baseConfig.cloudbase.resourceAppId,
    mode: baseConfig.cloudbase.mode as CloudbaseMode,
    identityFunctionName: __MIP_IDENTITY_FUNCTION_NAME__ || defaults.identityFunctionName,
    membershipFunctionName: __MIP_IDENTITY_FUNCTION_NAME__ || defaults.identityFunctionName,
    mediaFunctionName: __MIP_MEDIA_FUNCTION_NAME__ || defaults.mediaFunctionName,
    eventsFunctionName: __MIP_EVENTS_FUNCTION_NAME__ || defaults.eventsFunctionName,
    opportunitiesFunctionName: __MIP_OPPORTUNITIES_FUNCTION_NAME__ || defaults.opportunitiesFunctionName,
    communityFunctionName: __MIP_COMMUNITY_FUNCTION_NAME__ || defaults.communityFunctionName,
    commerceFunctionName: __MIP_COMMERCE_FUNCTION_NAME__ || defaults.commerceFunctionName,
    adminFunctionName: __MIP_ADMIN_FUNCTION_NAME__ || defaults.adminFunctionName,
    growthFunctionName: __MIP_GROWTH_FUNCTION_NAME__ || defaults.growthFunctionName,
    gameFunctionName: __MIP_GAME_FUNCTION_NAME__ || defaults.gameFunctionName,
    tasksFunctionName: __MIP_TASKS_FUNCTION_NAME__ || defaults.tasksFunctionName,
    bannersFunctionName: __MIP_BANNERS_FUNCTION_NAME__ || defaults.bannersFunctionName,
    aiFunctionName: __MIP_AI_FUNCTION_NAME__ || defaults.aiFunctionName,
    notificationsFunctionName: __MIP_NOTIFICATIONS_FUNCTION_NAME__ || defaults.notificationsFunctionName,
    paymentFunctionName: __MIP_PAY_FUNCTION_NAME__ || defaults.paymentFunctionName,
  },
  paymentMode: resolvedPaymentMode,
  catalogStage: catalogStage(__MIP_CATALOG_STAGE__ || defaults.catalogStage),
  subscribeTemplatesJson: __MIP_SUBSCRIBE_TEMPLATES_JSON__,
  unconfigured: {
    cloudbase: baseConfig.cloudbase.mode === 'disabled',
    payment: resolvedPaymentMode === 'disabled',
  },
} as const
