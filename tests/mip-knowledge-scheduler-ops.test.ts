import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertRollingSchedulerEnvironmentContract,
  assertRollingSchedulerFunctionReadback,
  KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC,
  MESSAGE_SCHEDULER_OPERATIONS_SPEC,
  resolveSchedulerOperationsSpec,
  rollingSchedulerAdminRuntimeContract,
  rollingSchedulerCloudConfig,
  rollingSchedulerCreateFunctionRequest,
  schedulerRuntimePolicy,
} from '../scripts/lib/message-scheduler-cloud.mjs'
import { createMipCoreFunctionManifest } from '../scripts/lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'
import { MIP_STABLE_SECRET_KEYS } from '../scripts/lib/mip-local-secrets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')
const secret = 'knowledge-scheduler-secret-at-least-32-bytes'

const baseEnv = {
  CLOUDBASE_ENV_ID: 'mip-test-env',
  CLOUDBASE_RESOURCE_UIN: '123456789',
  MIP_KNOWLEDGE_SCHEDULER_ROLE_NAME: 'MIPKnowledgeSchedulerRole',
  MIP_KNOWLEDGE_SCHEDULER_TRIGGER_NAME: 'mip-knowledge-ingestion-next',
  MIP_MESSAGE_SCHEDULER_ROLE_NAME: 'MIPMessageSchedulerRole',
  MIP_SCF_REGION: 'ap-shanghai',
  MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
}

const functionNames = resolveMipFunctionNames()
const config = rollingSchedulerCloudConfig(
  baseEnv,
  functionNames,
  KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC,
)
const environment = {
  MIP_ADMIN_FUNCTION_NAME: 'mip-admin-api',
  MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
  MIP_DEPLOYMENT_STAGE: 'test',
  MIP_KNOWLEDGE_SCHEDULER_CODE_MARKER: 'a'.repeat(64),
  MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME: 'mip-knowledge-scheduler',
  MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: secret,
  MIP_KNOWLEDGE_SCHEDULER_TRIGGER_NAME: 'mip-knowledge-ingestion-next',
  MIP_SCF_NAMESPACE: 'mip-test-env',
  MIP_SCF_REGION: 'ap-shanghai',
  MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
}

describe('MIP knowledge scheduler operations', () => {
  it('selects an explicit knowledge spec while preserving message defaults', () => {
    expect(resolveSchedulerOperationsSpec([])).toBe(MESSAGE_SCHEDULER_OPERATIONS_SPEC)
    expect(resolveSchedulerOperationsSpec(['--scheduler-kind=knowledge']))
      .toBe(KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)
    expect(() => resolveSchedulerOperationsSpec(['--scheduler-kind=']))
      .toThrow('--scheduler-kind must be message or knowledge')
    expect(() => resolveSchedulerOperationsSpec([
      '--scheduler-kind=knowledge',
      '--scheduler-kind=message',
    ])).toThrow('may only be provided once')
    expect(config).toMatchObject({
      adminFunctionName: 'mip-admin-api',
      functionName: 'mip-knowledge-scheduler',
      policyName: 'MIPKnowledgeSchedulerRolePolicy',
      roleName: 'MIPKnowledgeSchedulerRole',
      triggerName: 'mip-knowledge-ingestion-next',
    })
    expect(() => rollingSchedulerCloudConfig({
      ...baseEnv,
      MIP_KNOWLEDGE_SCHEDULER_ROLE_NAME: 'mipmessageschedulerrole',
    }, functionNames, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('role separate')
    expect(() => rollingSchedulerCloudConfig({
      ...baseEnv,
      MIP_KNOWLEDGE_SCHEDULER_ROLE_NAME: 'TCB_QcsRole',
    }, functionNames, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('dedicated non-TCB')
  })

  it('uses a dedicated minimum runtime role without database access', () => {
    const policy = schedulerRuntimePolicy(config)
    expect(policy.statement).toEqual([
      expect.objectContaining({ action: ['scf:UpdateTrigger'], resource: ['*'] }),
      expect.objectContaining({ action: ['scf:ListTriggers'] }),
      expect.objectContaining({ action: ['scf:InvokeFunction'], resource: ['*'] }),
    ])
    expect(JSON.stringify(policy)).not.toMatch(/mysql|database|vpc/i)
    expect(config.roleName).not.toBe('MIPMessageSchedulerRole')
    expect(config.roleName.toLowerCase()).not.toBe('tcb_qcsrole')
  })

  it('requires the same-domain admin HMAC link without an outbox dependency', () => {
    const admin = {
      MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
      MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME: 'mip-knowledge-scheduler',
      MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: secret,
    }
    expect(rollingSchedulerAdminRuntimeContract(admin, {
      requiredAppId: 'wx0123456789abcdef',
      schedulerFunctionName: 'mip-knowledge-scheduler',
    }, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toEqual({
      allowedAppIds: ['wx0123456789abcdef'],
      secret,
    })
    expect(() => rollingSchedulerAdminRuntimeContract({
      ...admin,
      MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: '',
    }, {
      schedulerFunctionName: 'mip-knowledge-scheduler',
    }, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('knowledge scheduling automation')
  })

  it('fails prewrite on any environment drift and creates raw SCF without a VPC', () => {
    expect(assertRollingSchedulerEnvironmentContract(
      environment,
      config,
      KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC,
    )).toBe(environment)
    expect(() => assertRollingSchedulerEnvironmentContract({
      ...environment,
      MIP_DB_CONNECTION_URI: 'mysql://forbidden',
    }, config, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('prewrite contract')
    expect(() => assertRollingSchedulerEnvironmentContract({
      ...environment,
      DATABASE_URL: 'mysql://forbidden',
    }, config, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('prewrite contract')
    expect(() => assertRollingSchedulerEnvironmentContract({
      ...environment,
      MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: `${secret} `,
    }, config, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('prewrite contract')
    const request = rollingSchedulerCreateFunctionRequest(
      config,
      environment,
      Buffer.from('zip-content').toString('base64'),
      KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC,
    )
    expect(request).toMatchObject({
      FunctionName: 'mip-knowledge-scheduler',
      Namespace: 'mip-test-env',
      Role: 'MIPKnowledgeSchedulerRole',
      MemorySize: 128,
      Runtime: 'Nodejs20.19',
      Type: 'Event',
    })
    expect(request).not.toHaveProperty('VpcConfig')
    expect(JSON.stringify(request.Environment)).not.toMatch(/MIP_DB_|MYSQL/)
  })

  it('requires exact postwrite function and environment readback', () => {
    const detail = {
      AvailableStatus: 'Available',
      Environment: {
        Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })),
      },
      FunctionName: config.functionName,
      Handler: 'index.main',
      MemorySize: 128,
      Namespace: config.envId,
      Role: config.roleName,
      Runtime: 'Nodejs20.19',
      Status: 'Active',
      Timeout: 60,
      Type: 'Event',
      VpcConfig: {},
    }
    expect(assertRollingSchedulerFunctionReadback(
      detail,
      config,
      environment,
      KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC,
    )).toBe(detail)
    expect(() => assertRollingSchedulerFunctionReadback({
      ...detail,
      VpcConfig: { VpcId: 'vpc-forbidden', SubnetId: 'subnet-forbidden' },
    }, config, environment, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('MySQL VPC')
    expect(() => assertRollingSchedulerFunctionReadback({
      ...detail,
      Role: 'MIPMessageSchedulerRole',
    }, config, environment, KNOWLEDGE_SCHEDULER_OPERATIONS_SPEC)).toThrow('dedicated role')
  })

  it('keeps raw schedulers outside ordinary CloudBase deployment', () => {
    const core = createMipCoreFunctionManifest(functionNames)
    expect(core).toHaveLength(16)
    expect(core.map(item => item.name)).not.toContain('mip-message-scheduler')
    expect(core.map(item => item.name)).not.toContain('mip-knowledge-scheduler')
    expect(read('cloudfunctions/mip-knowledge-scheduler/config.json')).not.toMatch(/timer|cron|vpc/i)
    const deployCore = read('scripts/deploy-functions.mjs')
    expect(deployCore).toContain('manifest.filter(spec => spec.name === requestedFunction)')
    expect(deployCore).toContain('--only must name exactly one function from the MIP core deployment manifest')
  })

  it('reuses one fail-closed role, deploy, canary, and verify control plane', () => {
    const role = read('scripts/configure-message-scheduler-role.mjs')
    const deploy = read('scripts/deploy-message-scheduler.mjs')
    const verify = read('scripts/verify-message-scheduler.mjs')
    for (const source of [role, deploy, verify]) {
      expect(source).toContain('resolveSchedulerOperationsSpec(process.argv.slice(2))')
      expect(source).not.toContain('../cloudfunctions/mip-message-scheduler')
    }
    expect(deploy.indexOf('assertRollingSchedulerEnvironmentContract(expectedEnvironment'))
      .toBeLessThan(deploy.indexOf('const existingSchedulerDetail'))
    expect(deploy.indexOf('const schedulerPreflight = preflightSchedulerTriggerInventory('))
      .toBeLessThan(deploy.indexOf('\'CreateFunction\''))
    expect(deploy).toContain('startCanary === Boolean(activateGeneration)')
    expect(deploy).toContain('readback.activationGeneration !== generation')
    expect(deploy).toContain('activationState.activationGeneration === activateGeneration')
    expect(deploy).toContain('disableClientInvocation()')
    expect(deploy).toContain('invoke: false')
    expect(verify).toContain('rules?.[config.functionName]?.invoke !== false')
    expect(verify).toContain('SCHEDULER_RESERVED_CONCURRENCY_MB')
    expect(verify).toContain('assertSingleSchedulerTrigger')
  })

  it('exposes stable secret initialization, admin injection, and dedicated commands', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    expect(scripts['cloud:knowledge-scheduler:role'])
      .toBe('node scripts/configure-message-scheduler-role.mjs --scheduler-kind=knowledge')
    expect(scripts['cloud:knowledge-scheduler:deploy'])
      .toBe('node scripts/deploy-message-scheduler.mjs --scheduler-kind=knowledge')
    expect(scripts['cloud:knowledge-scheduler:verify'])
      .toBe('node scripts/verify-message-scheduler.mjs --scheduler-kind=knowledge')
    expect(MIP_STABLE_SECRET_KEYS).toContain('MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET')
    expect(read('scripts/init-mip-secrets.mjs')).toContain('names.add(functionNames.knowledgeScheduler)')
    const deployCore = read('scripts/deploy-functions.mjs')
    expect(deployCore).toContain('MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME: options.functionNames.knowledgeScheduler')
    expect(deployCore).toContain('MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET: options.secrets.knowledgeSchedulerHmac')
    const example = read('.env.example')
    expect(example).toContain('MIP_KNOWLEDGE_SCHEDULER_ROLE_NAME=MIPKnowledgeSchedulerRole')
    expect(example).toContain('MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET=')
  })
})
