import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_DRAFT_PROVIDER_DEPLOYABLE_SOURCE_FILES,
  AI_DRAFT_PROVIDER_ENVIRONMENT_KEYS,
  AI_DRAFT_PROVIDER_FUNCTION_NAME,
  assertAiApiProviderLink,
  assertProviderFunctionReadback,
  exactHosts,
  providerEnvironment,
  providerSourceFingerprint,
  stageProviderSources,
} from '../scripts/lib/ai-draft-provider-cloud.mjs'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'cloudfunctions', AI_DRAFT_PROVIDER_FUNCTION_NAME)
const sourceMarker = providerSourceFingerprint(sourceRoot)
const aiEnvironment = {
  MIP_ALLOWED_APP_IDS: 'wx1234567890abcdef',
  MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: 'h'.repeat(48),
  MIP_AI_PROVIDER_FUNCTION_NAME: AI_DRAFT_PROVIDER_FUNCTION_NAME,
}
const localEnvironment = {
  OPENAI_BASE_URL: 'https://api.deepseek.com',
  OPENAI_MODEL: 'deepseek-v4-flash',
  OPENAI_API_KEY: `sk-${'k'.repeat(32)}`,
  MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: '5000',
}
const legacyEnvironment = {
  MIP_AI_DRAFT_UPSTREAM_ENDPOINT: 'https://provider.example.com/v1/drafts',
  MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS: 'provider.example.com',
  MIP_AI_DRAFT_UPSTREAM_SECRET: 's'.repeat(32),
  MIP_AI_DRAFT_UPSTREAM_TIMEOUT_MS: '5000',
}

describe('AI draft Provider cloud contract', () => {
  it('builds an exact no-database environment from the deployed AI trust boundary', () => {
    const environment = providerEnvironment({
      aiEnvironment,
      env: localEnvironment,
      sourceMarker,
    })
    expect(Object.keys(environment).every(key => AI_DRAFT_PROVIDER_ENVIRONMENT_KEYS.includes(key))).toBe(true)
    expect(environment.MIP_DB_CONNECTION_URI).toBeUndefined()
    expect(environment.MIP_AI_HMAC_SECRET).toBeUndefined()
    expect(environment.MIP_ALLOWED_APP_IDS).toBe(aiEnvironment.MIP_ALLOWED_APP_IDS)
    expect(environment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET)
      .toBe(aiEnvironment.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET)
    expect(environment.OPENAI_BASE_URL).toBe('https://api.deepseek.com/')
    expect(environment.OPENAI_MODEL).toBe('deepseek-v4-flash')
    expect(environment.MIP_AI_DRAFT_UPSTREAM_ENDPOINT).toBeUndefined()
  })

  it('keeps the legacy authenticated MIP upstream deployable', () => {
    const environment = providerEnvironment({
      aiEnvironment,
      env: legacyEnvironment,
      sourceMarker,
    })
    expect(environment.MIP_AI_DRAFT_UPSTREAM_ENDPOINT).toBe('https://provider.example.com/v1/drafts')
    expect(environment.MIP_AI_DRAFT_UPSTREAM_ALLOWED_HOSTS).toBe('provider.example.com')
    expect(environment.OPENAI_API_KEY).toBeUndefined()
  })

  it('stops before Provider deployment unless the existing AI API already targets the exact function', () => {
    expect(() => assertAiApiProviderLink(aiEnvironment)).not.toThrow()
    expect(() => assertAiApiProviderLink({
      ...aiEnvironment,
      MIP_AI_PROVIDER_FUNCTION_NAME: '',
    })).toThrow('before any Provider write')
    expect(() => assertAiApiProviderLink({
      ...aiEnvironment,
      MIP_AI_PROVIDER_FUNCTION_NAME: 'mip-other-provider',
    })).toThrow('before any Provider write')

    const deploySource = fs.readFileSync(
      path.join(root, 'scripts', 'deploy-ai-draft-provider.mjs'),
      'utf8',
    )
    const linkCheck = deploySource.indexOf('assertAiApiProviderLink(aiEnvironment, functionName)')
    const staging = deploySource.indexOf('fs.mkdtempSync(')
    const providerWrite = deploySource.search(/action: 'createFunction'/)
    expect(linkCheck).toBeGreaterThan(-1)
    expect(staging).toBeGreaterThan(linkCheck)
    expect(providerWrite).toBeGreaterThan(linkCheck)
    expect(deploySource).toContain('function delay(milliseconds)')
    expect(deploySource).not.toContain('const delay =')
  })

  it('requires exact HTTPS hosts and rejects wildcard/IP allowlists', () => {
    expect(exactHosts('provider.example.com,provider.example.com')).toEqual(['provider.example.com'])
    expect(exactHosts('*.example.com')).toEqual([])
    expect(exactHosts('127.0.0.1')).toEqual([])
  })

  it('rejects VPC, runtime, environment, and source-marker drift', () => {
    const environment = providerEnvironment({
      aiEnvironment,
      env: localEnvironment,
      sourceMarker,
    })
    const detail = {
      FunctionName: AI_DRAFT_PROVIDER_FUNCTION_NAME,
      Runtime: 'Nodejs20.19',
      Handler: 'index.main',
      Timeout: 15,
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

  it('keeps the deployable source independent of MySQL and timers', () => {
    const source = fs.readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .filter(value => value.endsWith('.js'))
      .map(value => fs.readFileSync(path.join(sourceRoot, value), 'utf8'))
      .join('\n')
    expect(source).not.toContain('MIP_DB_CONNECTION_URI')
    expect(source).not.toMatch(/\b(?:mysql2|createPool|setInterval)\b/)
  })

  it('stages only the fixed runtime allowlist and excludes tests and documentation', () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-ai-provider-stage-'))
    try {
      stageProviderSources(sourceRoot, destination)
      const staged = fs.readdirSync(destination, { recursive: true, encoding: 'utf8' })
        .filter(value => fs.statSync(path.join(destination, value)).isFile())
        .map(value => value.split(path.sep).join('/'))
        .sort()
      expect(staged).toEqual([...AI_DRAFT_PROVIDER_DEPLOYABLE_SOURCE_FILES].sort())
      expect(staged.some(value => value.startsWith('tests/'))).toBe(false)
      expect(staged).not.toContain('README.md')
    }
    finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })

  it('wires the optional Provider through local secrets, core deployment, and root commands', () => {
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    const localSecrets = fs.readFileSync(path.join(root, 'scripts/lib/mip-local-secrets.mjs'), 'utf8')
    const coreDeploy = fs.readFileSync(path.join(root, 'scripts/deploy-functions.mjs'), 'utf8')
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

    expect(envExample).not.toContain('MIP_AI_DRAFT_PROVIDER_HMAC_SECRET=')
    expect(envExample).toContain('MIP_AI_DRAFT_UPSTREAM_ENDPOINT=')
    expect(envExample).toContain('OPENAI_BASE_URL=https://api.deepseek.com')
    expect(envExample).toContain('OPENAI_MODEL=deepseek-v4-flash')
    expect(envExample).toContain('OPENAI_API_KEY=')
    expect(envExample).toContain('MIP_AI_PROVIDER_TIMEOUT_MS=8000')
    expect(localSecrets).toContain('\'MIP_AI_DRAFT_PROVIDER_HMAC_SECRET\'')
    expect(coreDeploy).toContain('aiDraftProviderHmac: stableSecretValues.MIP_AI_DRAFT_PROVIDER_HMAC_SECRET')
    expect(coreDeploy).toContain('MIP_AI_DRAFT_PROVIDER_HMAC_SECRET: options.secrets.aiDraftProviderHmac')
    expect(coreDeploy).toContain('MIP_AI_PROVIDER_TIMEOUT_MS: String(options.aiProviderTimeoutMs)')
    expect(coreDeploy).not.toContain('OPENAI_API_KEY')
    expect(packageJson.scripts['cloud:ai-draft-provider:deploy'])
      .toBe('node scripts/deploy-ai-draft-provider.mjs')
    expect(packageJson.scripts['cloud:ai-draft-provider:verify'])
      .toBe('node scripts/verify-ai-draft-provider.mjs')
  })
})
