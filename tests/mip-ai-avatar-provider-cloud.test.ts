import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_AVATAR_PROVIDER_DEPLOYABLE_SOURCE_FILES,
  AI_AVATAR_PROVIDER_ENVIRONMENT_KEYS,
  AI_AVATAR_PROVIDER_FUNCTION_NAME,
  assertAiApiProviderLink,
  assertProviderFunctionReadback,
  assertProviderTrustDomainsIsolated,
  exactHosts,
  providerBootstrapEnvironment,
  providerEnvironment,
  providerSourceFingerprint,
  stageProviderSources,
} from '../scripts/lib/ai-avatar-provider-cloud.mjs'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'cloudfunctions', AI_AVATAR_PROVIDER_FUNCTION_NAME)
const sourceMarker = providerSourceFingerprint(sourceRoot)
const aiEnvironment = {
  MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
  MIP_AI_HMAC_SECRET: 'm'.repeat(48),
  MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'd'.repeat(48),
  MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: AI_AVATAR_PROVIDER_FUNCTION_NAME,
  MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
}
const localEnvironment = {
  MIP_AI_AVATAR_UPSTREAM_ENDPOINT: 'https://avatar.example.com/v1/generate',
  MIP_AI_AVATAR_UPSTREAM_ALLOWED_HOSTS: 'avatar.example.com',
  MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: 's'.repeat(32),
  MIP_AI_AVATAR_UPSTREAM_TIMEOUT_MS: '12000',
}

describe('AI avatar Provider cloud contract', () => {
  it('builds an exact no-database environment from the deployed AI trust boundary', () => {
    const environment = providerEnvironment({
      aiEnvironment,
      env: localEnvironment,
      sourceMarker,
    })
    expect(Object.keys(environment).sort()).toEqual([...AI_AVATAR_PROVIDER_ENVIRONMENT_KEYS].sort())
    expect(environment.MIP_DB_CONNECTION_URI).toBeUndefined()
    expect(environment.MIP_AI_HMAC_SECRET).toBeUndefined()
    expect(environment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET).toBeUndefined()
    expect(environment.MIP_ALLOWED_APP_IDS).toBe(aiEnvironment.MIP_ALLOWED_APP_IDS)
    expect(environment.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET)
      .toBe(aiEnvironment.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET)
  })

  it('stops before Provider deployment unless the existing AI API already targets the exact function and HMAC', () => {
    expect(() => assertAiApiProviderLink(aiEnvironment)).not.toThrow()
    expect(() => assertAiApiProviderLink({
      ...aiEnvironment,
      MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: '',
    })).toThrow('before any Provider write')
    expect(() => assertAiApiProviderLink({
      ...aiEnvironment,
      MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: '',
    })).toThrow('before any Provider write')
    expect(() => assertAiApiProviderLink({
      ...aiEnvironment,
      MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: aiEnvironment.MIP_AI_HMAC_SECRET,
    })).toThrow('separate trust domains')

    const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-ai-avatar-provider.mjs'), 'utf8')
    const linkCheck = deploySource.indexOf('assertAiApiProviderLink(aiEnvironment, functionName)')
    const environmentCheck = deploySource.indexOf('providerEnvironment({ aiEnvironment, env, sourceMarker })')
    const staging = deploySource.indexOf('fs.mkdtempSync(')
    const providerWrite = deploySource.search(/action: 'createFunction'/)
    const denyAfterBootstrap = deploySource.indexOf('disableClientInvocation(functionName)', providerWrite)
    const codeUpdate = deploySource.indexOf('action: \'updateFunctionCode\'', denyAfterBootstrap)
    const configurationUpdate = deploySource.indexOf(
      'updateProviderConfiguration(functionName, expectedEnvironment)',
      codeUpdate,
    )
    expect(linkCheck).toBeGreaterThan(-1)
    expect(environmentCheck).toBeGreaterThan(linkCheck)
    expect(staging).toBeGreaterThan(environmentCheck)
    expect(providerWrite).toBeGreaterThan(staging)
    expect(denyAfterBootstrap).toBeGreaterThan(providerWrite)
    expect(codeUpdate).toBeGreaterThan(denyAfterBootstrap)
    expect(configurationUpdate).toBeGreaterThan(codeUpdate)
    expect(deploySource).toContain('assertNoFunctionTriggers(functionName)')
  })

  it('creates a new function with only non-sensitive fail-closed bootstrap configuration', () => {
    expect(providerBootstrapEnvironment(sourceMarker)).toEqual({
      MIP_AI_AVATAR_PROVIDER_CODE_MARKER: sourceMarker,
      MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME: AI_AVATAR_PROVIDER_FUNCTION_NAME,
    })
  })

  it('keeps upstream authentication outside every AI HMAC trust domain', () => {
    expect(() => assertProviderTrustDomainsIsolated({
      aiEnvironment,
      upstreamAuthSecret: aiEnvironment.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET,
    })).toThrow('separate trust domains')
    expect(() => providerEnvironment({
      aiEnvironment,
      env: {
        ...localEnvironment,
        MIP_AI_AVATAR_UPSTREAM_AUTH_SECRET: aiEnvironment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET,
      },
      sourceMarker,
    })).toThrow('separate trust domains')
  })

  it('requires exact HTTPS hosts and rejects wildcard/IP allowlists', () => {
    expect(exactHosts('avatar.example.com,avatar.example.com')).toEqual(['avatar.example.com'])
    expect(exactHosts('*.example.com')).toEqual([])
    expect(exactHosts('127.0.0.1')).toEqual([])
  })

  it('rejects VPC, runtime, environment, and source-marker drift', () => {
    const environment = providerEnvironment({ aiEnvironment, env: localEnvironment, sourceMarker })
    const detail = {
      FunctionName: AI_AVATAR_PROVIDER_FUNCTION_NAME,
      Runtime: 'Nodejs20.19',
      Handler: 'index.main',
      Timeout: 55,
      Status: 'Active',
      AvailableStatus: 'Available',
      VpcConfig: { VpcId: '', SubnetId: '' },
      Environment: {
        Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })),
      },
    }
    expect(() => assertProviderFunctionReadback(detail, environment)).not.toThrow()
    expect(() => assertProviderFunctionReadback({
      ...detail,
      VpcConfig: { VpcId: 'vpc-shared', SubnetId: 'subnet-shared' },
    }, environment)).toThrow('must not join a VPC')
    expect(() => assertProviderFunctionReadback({
      ...detail,
      Environment: {
        Variables: [...detail.Environment.Variables, { Key: 'MIP_DB_CONNECTION_URI', Value: 'redacted' }],
      },
    }, environment)).toThrow('unexpected keys')
  })

  it('stages only the fixed runtime manifest and excludes tests and documentation', () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-ai-avatar-provider-stage-'))
    try {
      stageProviderSources(sourceRoot, destination)
      const staged = fs.readdirSync(destination, { recursive: true, encoding: 'utf8' })
        .filter(value => fs.statSync(path.join(destination, value)).isFile())
        .map(value => value.split(path.sep).join('/'))
        .sort()
      expect(staged).toEqual([...AI_AVATAR_PROVIDER_DEPLOYABLE_SOURCE_FILES].sort())
      expect(staged.some(value => value.startsWith('tests/'))).toBe(false)
      expect(staged).not.toContain('README.md')
    }
    finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })

  it('wires the optional Provider through secrets, core deployment, canonical MCP, and commands', () => {
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    const localSecrets = fs.readFileSync(path.join(root, 'scripts/lib/mip-local-secrets.mjs'), 'utf8')
    const coreDeploy = fs.readFileSync(path.join(root, 'scripts/deploy-functions.mjs'), 'utf8')
    const mcporter = JSON.parse(fs.readFileSync(path.join(root, 'config/mcporter.json'), 'utf8'))
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

    expect(envExample).toContain('MIP_AI_AVATAR_PROVIDER_HMAC_SECRET=')
    expect(envExample).toContain('MIP_AI_AVATAR_UPSTREAM_ENDPOINT=')
    expect(envExample).toContain('MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS=45000')
    expect(localSecrets).toContain('\'MIP_AI_AVATAR_PROVIDER_HMAC_SECRET\'')
    expect(coreDeploy).toContain('aiAvatarProviderHmac: stableSecretValues.MIP_AI_AVATAR_PROVIDER_HMAC_SECRET')
    expect(coreDeploy).toContain('MIP_AI_AVATAR_PROVIDER_HMAC_SECRET: options.secrets.aiAvatarProviderHmac')
    expect(coreDeploy).toContain('MIP_AI_AVATAR_PROVIDER_TIMEOUT_MS: String(options.aiAvatarProviderTimeoutMs)')
    expect(mcporter.mcpServers.cloudbase.args).toContain('@cloudbase/cloudbase-mcp@2.32.3')
    expect(packageJson.scripts['cloud:ai-avatar-provider:deploy'])
      .toBe('node scripts/deploy-ai-avatar-provider.mjs')
    expect(packageJson.scripts['cloud:ai-avatar-provider:verify'])
      .toBe('node scripts/verify-ai-avatar-provider.mjs')
  })
})
