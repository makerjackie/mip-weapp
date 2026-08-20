export type CloudbaseMode = 'disabled' | 'direct' | 'shared'

export interface RuntimeConfigInput {
  appName: string
  appNamespace: string
  appVersion: string
  buildSha: string
  cloudbaseEnvId: string
  cloudbaseResourceAppId: string
  cloudbaseFunctionName: string
}

export interface RuntimeConfig {
  app: {
    name: string
    namespace: string
    version: string
    buildSha: string
  }
  cloudbase: {
    mode: CloudbaseMode
    envId: string
    resourceAppId: string
    functionName: string
  }
}

function normalize(value: string) {
  return value.trim()
}

export function createRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const envId = normalize(input.cloudbaseEnvId)
  const resourceAppId = normalize(input.cloudbaseResourceAppId)
  const namespace = normalize(input.appNamespace)

  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(namespace)) {
    throw new Error('APP_NAMESPACE must be 1-64 lowercase letters, numbers, and hyphens')
  }
  if (resourceAppId && !envId) {
    throw new Error('CLOUDBASE_RESOURCE_APP_ID requires CLOUDBASE_ENV_ID')
  }

  return {
    app: {
      name: normalize(input.appName) || '01MVP App',
      namespace,
      version: normalize(input.appVersion),
      buildSha: normalize(input.buildSha) || 'development',
    },
    cloudbase: {
      mode: !envId ? 'disabled' : resourceAppId ? 'shared' : 'direct',
      envId,
      resourceAppId,
      functionName: normalize(input.cloudbaseFunctionName) || 'gateway',
    },
  }
}

export function getPublicDiagnostics(config: RuntimeConfig) {
  return {
    appName: config.app.name,
    appNamespace: config.app.namespace,
    version: config.app.version,
    buildSha: config.app.buildSha,
    cloudbaseMode: config.cloudbase.mode,
    cloudbaseConfigured: config.cloudbase.mode !== 'disabled',
  }
}
