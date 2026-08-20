import type { WeappCloudClient } from '@weapp/platform/cloudbase'
import { createCloudbaseRuntime } from '@weapp/platform/cloudbase'
import { runtimeConfig } from '../../config/runtime'

export type CaseCloudClient = WeappCloudClient

const cloudbaseRuntime = createCloudbaseRuntime({
  app: {
    name: runtimeConfig.appName,
    namespace: runtimeConfig.appNamespace,
    version: runtimeConfig.appVersion,
    buildSha: runtimeConfig.buildSha,
  },
  cloudbase: {
    mode: runtimeConfig.cloudbase.mode,
    envId: runtimeConfig.cloudbase.envId,
    resourceAppId: runtimeConfig.cloudbase.resourceAppId,
    functionName: runtimeConfig.cloudbase.membershipFunctionName,
  },
}, {
  disabledMessage: '会员服务暂未开放',
  initializingMessage: '正在连接会员服务',
  unavailableMessage: '会员服务暂时不可用',
})

export function initializeCloudbase() {
  cloudbaseRuntime.initialize()
}

export async function requireCloudClient(): Promise<CaseCloudClient> {
  return cloudbaseRuntime.requireClient()
}
