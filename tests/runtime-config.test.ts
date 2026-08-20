import { createRuntimeConfig, getPublicDiagnostics } from '@weapp/platform/runtime-config'
import { describe, expect, it } from 'vitest'

const baseInput = {
  appName: 'Example',
  appNamespace: 'example',
  appVersion: '1.2.3',
  buildSha: 'abc123',
  cloudbaseEnvId: '',
  cloudbaseResourceAppId: '',
  cloudbaseFunctionName: 'gateway',
}

describe('runtime config', () => {
  it('keeps UI development available without CloudBase', () => {
    const config = createRuntimeConfig(baseInput)
    expect(config.cloudbase.mode).toBe('disabled')
  })

  it('does not expose the retired Starter name when an app name is missing', () => {
    const config = createRuntimeConfig({
      ...baseInput,
      appName: ' ',
    })
    expect(config.app.name).toBe('01MVP App')
  })

  it('uses direct mode for a local app environment', () => {
    const config = createRuntimeConfig({
      ...baseInput,
      cloudbaseEnvId: 'env-example',
    })
    expect(config.cloudbase.mode).toBe('direct')
  })

  it('uses shared mode only when resource AppID and EnvID are both present', () => {
    const config = createRuntimeConfig({
      ...baseInput,
      cloudbaseEnvId: 'env-shared',
      cloudbaseResourceAppId: 'wxresource',
    })
    expect(config.cloudbase.mode).toBe('shared')
  })

  it('rejects an incomplete shared-environment configuration', () => {
    expect(() => createRuntimeConfig({
      ...baseInput,
      cloudbaseResourceAppId: 'wxresource',
    })).toThrow('requires CLOUDBASE_ENV_ID')
  })

  it('rejects a namespace that cannot safely scope shared resources', () => {
    expect(() => createRuntimeConfig({
      ...baseInput,
      appNamespace: '../other-app',
    })).toThrow('APP_NAMESPACE')
  })

  it('never exposes environment or AppID values in public diagnostics', () => {
    const config = createRuntimeConfig({
      ...baseInput,
      cloudbaseEnvId: 'env-private-value',
      cloudbaseResourceAppId: 'wx-private-value',
    })
    const diagnostics = JSON.stringify(getPublicDiagnostics(config))
    expect(diagnostics).not.toContain('env-private-value')
    expect(diagnostics).not.toContain('wx-private-value')
  })
})
