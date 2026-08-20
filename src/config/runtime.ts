import { createRuntimeConfig } from '@weapp/platform/runtime-config'
import { brand } from './brand'
import { defaults } from './defaults'
import { features } from './features'

export type CloudbaseMode = 'disabled' | 'direct' | 'shared'
export type PaymentMode = 'disabled' | 'test' | 'live'

function paymentMode(value: string): PaymentMode {
  return value === 'test' || value === 'live' ? value : 'disabled'
}

const baseConfig = createRuntimeConfig({
  appName: __APP_NAME__ || brand.productName,
  appNamespace: __APP_NAMESPACE__ || defaults.appNamespace,
  appVersion: __APP_VERSION__,
  buildSha: __BUILD_SHA__,
  cloudbaseEnvId: __CLOUDBASE_ENV_ID__,
  cloudbaseResourceAppId: __CLOUDBASE_RESOURCE_APP_ID__,
  cloudbaseFunctionName: __MEMBERSHIP_FUNCTION_NAME__ || defaults.membershipFunctionName,
})

const resolvedPaymentMode = paymentMode(__PAYMENT_MODE__ || defaults.paymentMode)

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
    membershipFunctionName: __MEMBERSHIP_FUNCTION_NAME__ || defaults.membershipFunctionName,
    adminFunctionName: __ADMIN_FUNCTION_NAME__ || defaults.adminFunctionName,
    paymentFunctionName: __PAY_FUNCTION_NAME__ || defaults.paymentFunctionName,
  },
  paymentMode: resolvedPaymentMode,
  subscribeTemplatesJson: __SUBSCRIBE_TEMPLATES_JSON__,
  unconfigured: {
    cloudbase: baseConfig.cloudbase.mode === 'disabled',
    payment: resolvedPaymentMode === 'disabled',
  },
} as const
