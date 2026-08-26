import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertExistingSchedulerFunctionIdentity,
  assertSchedulerFunctionReadback,
  assertSingleSchedulerTrigger,
  asyncEventRetryConfig,
  camPolicyDocument,
  camRoleInfo,
  normalizeTriggerEnable,
  preflightSchedulerTriggerInventory,
  reservedConcurrency,
  SCF_ROLE_SERVICE_PRINCIPAL,
  SCHEDULER_ASYNC_MSG_TTL_SECONDS,
  SCHEDULER_ASYNC_RETRY_NUM,
  SCHEDULER_DEPLOYABLE_SOURCE_FILES,
  SCHEDULER_MEMORY_MB,
  SCHEDULER_RESERVED_CONCURRENCY_MB,
  schedulerAdminRuntimeContract,
  schedulerCloudConfig,
  schedulerCreateFunctionRequest,
  schedulerRuntimePolicy,
  schedulerScfCloudApiRequest,
  schedulerSourceFingerprint,
  schedulerTrustPolicy,
  triggerList,
} from '../scripts/lib/message-scheduler-cloud.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('MIP rolling message scheduler operations', () => {
  it('keeps the scheduler outside the 16 database core functions', () => {
    const manifest = read('scripts/lib/mip-function-manifest.mjs')
    const scheduler = JSON.parse(read('cloudfunctions/mip-message-scheduler/package.json'))
    expect(manifest).not.toContain('\'scheduler\',')
    expect(scheduler.name).toBe('mip-message-scheduler')
    expect(scheduler.dependencies['tencentcloud-sdk-nodejs-scf']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read('cloudfunctions/mip-message-scheduler/index.js')).not.toContain('MIP_DB_CONNECTION_URI')
    expect(SCHEDULER_DEPLOYABLE_SOURCE_FILES).toEqual([
      'domain/scheduler.js',
      'index.js',
      'lib/admin-client.js',
      'lib/auth.js',
      'lib/config.js',
      'lib/scf.js',
      'lib/trigger-controller.js',
      'package.json',
    ])
  })

  it('uses one rolling one-shot timer, canary confirmation, and single concurrency', () => {
    const deploy = read('scripts/deploy-message-scheduler.mjs')
    const verify = read('scripts/verify-message-scheduler.mjs')
    expect(SCHEDULER_MEMORY_MB).toBe(128)
    expect(SCHEDULER_RESERVED_CONCURRENCY_MB).toBe(128)
    expect(SCHEDULER_ASYNC_RETRY_NUM).toBe(2)
    expect(SCHEDULER_ASYNC_MSG_TTL_SECONDS).toBe(3600)
    expect(reservedConcurrency({ ReservedMem: 128 })).toBe(128)
    expect(asyncEventRetryConfig({
      AsyncTriggerConfig: { MsgTTL: 3600, RetryConfig: [{ RetryNum: 2 }, { RetryNum: -1 }] },
    })).toEqual({ msgTtl: 3600, retryNum: 2 })
    expect(normalizeTriggerEnable(1)).toBe('OPEN')
    expect(normalizeTriggerEnable(0)).toBe('CLOSE')
    expect(schedulerCloudConfig({
      CLOUDBASE_ENV_ID: 'mip-test-env',
      MIP_SCF_REGION: 'ap-shanghai',
      MIP_MESSAGE_SCHEDULER_ROLE_NAME: 'MIPMessageSchedulerRole',
      CLOUDBASE_RESOURCE_UIN: '123456789',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }, {
      admin: 'mip-admin-api',
      scheduler: 'mip-message-scheduler',
    }).region).toBe('ap-shanghai')
    expect(() => schedulerCloudConfig({
      CLOUDBASE_ENV_ID: 'mip-test-env',
      MIP_SCF_REGION: 'ap-test-1',
      MIP_MESSAGE_SCHEDULER_ROLE_NAME: 'MIPMessageSchedulerRole',
      CLOUDBASE_RESOURCE_UIN: '123456789',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '',
    }, {
      admin: 'mip-admin-api',
      scheduler: 'mip-message-scheduler',
    })).toThrow('MIP_SCF_TIMER_UTC_OFFSET_MINUTES')
    expect(deploy).toContain('triggerName: config.triggerName')
    expect(deploy).toContain('purpose: \'CANARY\'')
    expect(deploy).toContain('CustomArgument: JSON.stringify(message)')
    expect(deploy).toContain('\'PutReservedConcurrencyConfig\'')
    expect(deploy).toContain('\'UpdateFunctionEventInvokeConfig\'')
    expect(deploy).toContain('\'GetFunctionEventInvokeConfig\'')
    expect(deploy).toContain('--activate-after-canary=')
    expect(deploy).toContain('--confirm-resume-missing-trigger=')
    expect(deploy).toContain('createSchedulerActivation')
    expect(deploy).toContain('rollingSchedulerCreateFunctionRequest(config, expectedEnvironment, zipFile, spec)')
    expect(deploy).toContain('callScf(\'UpdateFunctionCode\'')
    expect(deploy).toContain('Role: config.roleName')
    expect(deploy).not.toContain('config.roleArn')
    expect(deploy).not.toContain('action: \'createFunction\'')
    expect(deploy).not.toContain('action: \'updateFunctionCode\'')
    expect(deploy).toContain('schedulerScfCloudApiRequest(config, action, params)')
    expect(verify).toContain('schedulerScfCloudApiRequest(config, action, params)')
    expect(deploy).toContain('rollingSchedulerAdminRuntimeContract(adminEnvironment')
    expect(verify).toContain('rollingSchedulerAdminRuntimeContract(adminVariables')
    expect(deploy.indexOf('assertExistingSchedulerFunctionIdentity(existingSchedulerDetail'))
      .toBeLessThan(deploy.indexOf('\'CreateFunction\''))
    expect(deploy.indexOf('const schedulerPreflight = preflightSchedulerTriggerInventory('))
      .toBeLessThan(deploy.indexOf('\'CreateFunction\''))
    expect(verify).toContain('assertSingleSchedulerTrigger')
    expect(verify).toContain('value?.Role !== config.roleName')
    expect(deploy).not.toMatch(/every-5m|\*\/5|2099/)
  })

  it('uses a dedicated minimum role and never mutates the shared CloudBase role', () => {
    const policy = schedulerRuntimePolicy({
      region: 'ap-test-1',
      resourceUin: '123456789',
      envId: 'mip-test-env',
      functionName: 'mip-message-scheduler',
      adminFunctionName: 'mip-admin-api',
    })
    expect(policy.statement).toEqual([
      expect.objectContaining({ action: ['scf:UpdateTrigger'], resource: ['*'] }),
      expect.objectContaining({ action: ['scf:ListTriggers'] }),
      expect.objectContaining({ action: ['scf:InvokeFunction'], resource: ['*'] }),
    ])
    expect(SCF_ROLE_SERVICE_PRINCIPAL).toBe('scf.qcloud.com')
    expect(schedulerTrustPolicy().statement[0].principal.service).toEqual(['scf.qcloud.com'])
    expect(camRoleInfo({ Response: { RoleInfo: { RoleName: 'MIPMessageSchedulerRole' } } }))
      .toEqual({ RoleName: 'MIPMessageSchedulerRole' })
    expect(camPolicyDocument({ Response: { PolicyDocument: JSON.stringify(policy) } }))
      .toEqual(policy)
    const role = read('scripts/configure-message-scheduler-role.mjs')
    const contract = read('scripts/lib/message-scheduler-cloud.mjs')
    expect(role).toContain('touchesSharedTcbRole: false')
    expect(contract).toContain('roleName.toLowerCase() === \'tcb_qcsrole\'')
    expect(() => schedulerCloudConfig({
      CLOUDBASE_ENV_ID: 'mip-test-env',
      MIP_SCF_REGION: 'ap-shanghai',
      MIP_MESSAGE_SCHEDULER_ROLE_NAME: 'tcb_qcsrole',
      CLOUDBASE_RESOURCE_UIN: '123456789',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }, {
      admin: 'mip-admin-api',
      scheduler: 'mip-message-scheduler',
    })).toThrow('dedicated non-TCB')
    expect(role).not.toContain('UpdateRole')
    expect(role).not.toContain('UpdatePolicy')
    expect(role).toContain('resolveMipDeploymentStage')
    expect(role).toContain('attachedReadback.length !== 1')
    expect(read('scripts/deploy-message-scheduler.mjs')).toContain('role?.RoleName !== config.roleName')
    expect(read('scripts/verify-message-scheduler.mjs')).toContain('policies.length !== 1')
  })

  it('creates through raw SCF with the dedicated role on the first write path', () => {
    const config = {
      adminFunctionName: 'mip-admin-api',
      cronUtcOffsetMinutes: 480,
      envId: 'mip-test-env',
      functionName: 'mip-message-scheduler',
      region: 'ap-shanghai',
      roleName: 'MIPMessageSchedulerRole',
      triggerName: 'mip-message-campaign-next',
    }
    const request = schedulerCreateFunctionRequest(config, {
      MIP_ADMIN_FUNCTION_NAME: 'mip-admin-api',
      MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MESSAGE_DISPATCH_HMAC_SECRET: 'message-dispatch-secret-at-least-32-bytes',
      MIP_MESSAGE_SCHEDULER_CODE_MARKER: 'a'.repeat(64),
      MIP_MESSAGE_SCHEDULER_FUNCTION_NAME: 'mip-message-scheduler',
      MIP_MESSAGE_SCHEDULER_TRIGGER_NAME: 'mip-message-campaign-next',
      MIP_SCF_NAMESPACE: 'mip-test-env',
      MIP_SCF_REGION: 'ap-shanghai',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }, Buffer.from('zip-content').toString('base64'))
    expect(request).toMatchObject({
      FunctionName: 'mip-message-scheduler',
      Namespace: 'mip-test-env',
      Role: 'MIPMessageSchedulerRole',
      MemorySize: 128,
      Runtime: 'Nodejs20.19',
      Handler: 'index.main',
      InstallDependency: 'TRUE',
      CodeSource: 'ZipFile',
    })
    expect(request.Code.ZipFile).toBe(Buffer.from('zip-content').toString('base64'))
    expect(request).not.toHaveProperty('VpcConfig')
    const deploy = read('scripts/deploy-message-scheduler.mjs')
    const createIndex = deploy.indexOf('\'CreateFunction\'')
    expect(createIndex).toBeGreaterThan(0)
    expect(createIndex).toBeLessThan(deploy.indexOf('callScf(\'UpdateFunctionConfiguration\''))
    expect(createIndex).toBeLessThan(deploy.indexOf('callScf(\'UpdateFunctionCode\''))
  })

  it('pins every scheduler SCF control-plane request to the configured region', () => {
    const config = { region: 'ap-shanghai' }
    const actions = [
      'CreateFunction',
      'GetFunction',
      'UpdateFunctionCode',
      'UpdateFunctionConfiguration',
      'ListTriggers',
      'CreateTrigger',
      'UpdateTrigger',
      'GetFunctionEventInvokeConfig',
      'UpdateFunctionEventInvokeConfig',
      'GetReservedConcurrencyConfig',
      'PutReservedConcurrencyConfig',
    ]
    for (const action of actions) {
      const params = { FunctionName: 'mip-message-scheduler' }
      expect(schedulerScfCloudApiRequest(config, action, params)).toEqual({
        service: 'scf',
        action,
        params,
        region: 'ap-shanghai',
      })
    }
  })

  it('blocks canary and activation unless the admin outbox runtime is complete', () => {
    const environment = {
      MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
      MIP_MESSAGE_DISPATCH_HMAC_SECRET: 'message-dispatch-secret-at-least-32-bytes',
      MIP_MESSAGE_SCHEDULER_FUNCTION_NAME: 'mip-message-scheduler',
      MIP_OUTBOX_FUNCTION_NAME: 'mip-outbox-worker',
      MIP_OUTBOX_HMAC_SECRET: 'outbox-secret-at-least-32-bytes-value',
    }
    const expected = {
      requiredAppId: 'wx0123456789abcdef',
      schedulerFunctionName: 'mip-message-scheduler',
      outboxFunctionName: 'mip-outbox-worker',
    }
    expect(schedulerAdminRuntimeContract(environment, expected)).toEqual({
      allowedAppIds: ['wx0123456789abcdef'],
      dispatchSecret: 'message-dispatch-secret-at-least-32-bytes',
    })
    expect(() => schedulerAdminRuntimeContract({
      ...environment,
      MIP_OUTBOX_FUNCTION_NAME: '',
    }, expected)).toThrow('Admin runtime is not ready')
    expect(() => schedulerAdminRuntimeContract({
      ...environment,
      MIP_OUTBOX_HMAC_SECRET: '',
    }, expected)).toThrow('Admin runtime is not ready')
  })

  it('rejects an existing shared-role scheduler before any deployment write', () => {
    let writes = 0
    const deployAfterIdentityPreflight = () => {
      assertExistingSchedulerFunctionIdentity({
        Role: 'TCB_QcsRole',
        VpcConfig: {},
      }, { roleName: 'MIPMessageSchedulerRole' })
      writes += 1
    }
    expect(deployAfterIdentityPreflight).toThrow('dedicated role')
    expect(writes).toBe(0)
  })

  it('resumes a response-lost raw create only with exact function and source proof', () => {
    const marker = schedulerSourceFingerprint(path.join(
      root,
      'cloudfunctions',
      'mip-message-scheduler',
    ))
    const config = {
      adminFunctionName: 'mip-admin-api',
      cronUtcOffsetMinutes: 480,
      envId: 'mip-test-env',
      functionName: 'mip-message-scheduler',
      region: 'ap-shanghai',
      roleName: 'MIPMessageSchedulerRole',
      triggerName: 'mip-message-campaign-next',
    }
    const expectedEnvironment = {
      MIP_ADMIN_FUNCTION_NAME: 'mip-admin-api',
      MIP_ALLOWED_APP_IDS: 'wx0123456789abcdef',
      MIP_DEPLOYMENT_STAGE: 'test',
      MIP_MESSAGE_DISPATCH_HMAC_SECRET: 'message-dispatch-secret-at-least-32-bytes',
      MIP_MESSAGE_SCHEDULER_CODE_MARKER: marker,
      MIP_MESSAGE_SCHEDULER_FUNCTION_NAME: 'mip-message-scheduler',
      MIP_MESSAGE_SCHEDULER_TRIGGER_NAME: 'mip-message-campaign-next',
      MIP_SCF_NAMESPACE: 'mip-test-env',
      MIP_SCF_REGION: 'ap-shanghai',
      MIP_SCF_TIMER_UTC_OFFSET_MINUTES: '480',
    }
    const existing = {
      AvailableStatus: 'Available',
      Environment: {
        Variables: Object.entries(expectedEnvironment).map(([Key, Value]) => ({ Key, Value })),
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
    expect(assertSchedulerFunctionReadback(existing, config, expectedEnvironment)).toBe(existing)
    expect(() => preflightSchedulerTriggerInventory(existing, {
      TotalCount: 0,
      Triggers: [],
    }, config)).toThrow('exactly one')
    expect(preflightSchedulerTriggerInventory(existing, {
      TotalCount: 0,
      Triggers: [],
    }, config, { allowMissingExisting: true })).toEqual({
      exists: true,
      resumingMissingTrigger: true,
      trigger: null,
    })
    expect(() => assertSchedulerFunctionReadback({
      ...existing,
      Environment: {
        Variables: Object.entries({
          ...expectedEnvironment,
          MIP_MESSAGE_SCHEDULER_CODE_MARKER: 'b'.repeat(64),
        }).map(([Key, Value]) => ({ Key, Value })),
      },
    }, config, expectedEnvironment)).toThrow('environment readback')
  })

  it('fails closed on partial, duplicate, or non-default trigger inventories', () => {
    const config = { triggerName: 'mip-message-campaign-next' }
    const fixed = {
      TriggerName: config.triggerName,
      Type: 'timer',
      Qualifier: '$DEFAULT',
    }
    expect(assertSingleSchedulerTrigger(triggerList({
      TotalCount: 1,
      Triggers: [fixed],
    }), config)).toEqual(fixed)
    expect(assertSingleSchedulerTrigger(triggerList({ TotalCount: 0 }), config, {
      allowMissing: true,
    })).toBeNull()
    expect(() => triggerList({ TotalCount: 2, Triggers: [fixed] }))
      .toThrow('inventory could not be read')
    expect(() => assertSingleSchedulerTrigger([fixed, { ...fixed }], config))
      .toThrow('exactly one')
    expect(() => assertSingleSchedulerTrigger([{ ...fixed, Qualifier: '1' }], config))
      .toThrow('identity is invalid')
  })

  it('performs no deployment write after an existing trigger inventory fails preflight', () => {
    let writes = 0
    const deployAfterPreflight = () => {
      preflightSchedulerTriggerInventory({ Status: 'Active' }, {
        TotalCount: 2,
        Triggers: [
          { TriggerName: 'mip-message-campaign-next', Type: 'timer', Qualifier: '$DEFAULT' },
          { TriggerName: 'unexpected', Type: 'timer', Qualifier: '$DEFAULT' },
        ],
      }, { triggerName: 'mip-message-campaign-next' })
      writes += 1
    }
    expect(deployAfterPreflight).toThrow('exactly one')
    expect(writes).toBe(0)
  })

  it('exposes confirmed deploy and separate verification commands', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    expect(scripts['cloud:message-scheduler:role']).toBe('node scripts/configure-message-scheduler-role.mjs')
    expect(scripts['cloud:message-scheduler:deploy']).toBe('node scripts/deploy-message-scheduler.mjs')
    expect(scripts['cloud:message-scheduler:verify']).toBe('node scripts/verify-message-scheduler.mjs')
  })
})
