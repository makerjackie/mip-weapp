import type { WeappCloudClient } from './runtime'
import { runtimeConfig } from '../../config/runtime'
import { createCloudbaseRuntime } from './runtime'

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
    functionName: runtimeConfig.cloudbase.identityFunctionName,
  },
}, {
  disabledMessage: '服务暂未开放',
  initializingMessage: '正在连接服务',
  unavailableMessage: '服务暂时不可用',
})

export function initializeCloudbase() {
  cloudbaseRuntime.initialize()
}

export async function requireCloudClient(): Promise<CaseCloudClient> {
  return cloudbaseRuntime.requireClient()
}
