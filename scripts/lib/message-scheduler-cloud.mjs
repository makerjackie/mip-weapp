import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const SCHEDULER_MEMORY_MB = 128
export const SCHEDULER_RESERVED_CONCURRENCY_MB = 128
export const SCHEDULER_ASYNC_RETRY_NUM = 2
export const SCHEDULER_ASYNC_MSG_TTL_SECONDS = 3600
export const SCHEDULER_RUNTIME = 'Nodejs20.19'
export const SCHEDULER_TIMEOUT_SECONDS = 60
export const SCF_ROLE_SERVICE_PRINCIPAL = 'scf.qcloud.com'
export const SCHEDULER_DEPLOYABLE_SOURCE_FILES = Object.freeze([
  'domain/scheduler.js',
  'index.js',
  'lib/admin-client.js',
  'lib/auth.js',
  'lib/config.js',
  'lib/scf.js',
  'lib/trigger-controller.js',
  'package.json',
])

export function schedulerCloudConfig(env, functionNames) {
  const envId = text(env.CLOUDBASE_ENV_ID)
  const region = text(env.MIP_SCF_REGION)
  const triggerName = text(env.MIP_MESSAGE_SCHEDULER_TRIGGER_NAME || 'mip-message-campaign-next')
  const roleName = text(env.MIP_MESSAGE_SCHEDULER_ROLE_NAME || 'MIPMessageSchedulerRole')
  const resourceUin = text(env.CLOUDBASE_RESOURCE_UIN)
  const cronUtcOffsetSource = text(env.MIP_SCF_TIMER_UTC_OFFSET_MINUTES)
  const cronUtcOffsetMinutes = Number(cronUtcOffsetSource)
  if (!/^[\w-]{1,64}$/.test(envId)) {
    throw new Error('CLOUDBASE_ENV_ID is invalid')
  }
  if (!/^[a-z]{2,12}-[a-z0-9]{2,20}(?:-[a-z0-9]{1,20}){0,2}$/.test(region)) {
    throw new Error('MIP_SCF_REGION is invalid')
  }
  if (!/^mip-[a-z0-9][a-z0-9-]{0,95}$/.test(triggerName)) {
    throw new Error('MIP_MESSAGE_SCHEDULER_TRIGGER_NAME is invalid')
  }
  if (!/^[A-Z]\w{1,63}$/i.test(roleName) || roleName.toLowerCase() === 'tcb_qcsrole') {
    throw new Error('A dedicated non-TCB scheduler role is required')
  }
  if (!/^\d{5,20}$/.test(resourceUin)) {
    throw new Error('CLOUDBASE_RESOURCE_UIN is invalid')
  }
  if (!/^-?\d{1,4}$/.test(cronUtcOffsetSource)
    || !Number.isInteger(cronUtcOffsetMinutes)
    || cronUtcOffsetMinutes < -840
    || cronUtcOffsetMinutes > 840) {
    throw new Error('MIP_SCF_TIMER_UTC_OFFSET_MINUTES must be an integer from -840 to 840')
  }
  return Object.freeze({
    adminFunctionName: functionNames.admin,
    cronUtcOffsetMinutes,
    envId,
    functionName: functionNames.scheduler,
    policyName: `${roleName}Policy`,
    region,
    resourceUin,
    roleName,
    triggerName,
  })
}

export function schedulerRuntimePolicy(config) {
  return {
    version: '2.0',
    statement: [
      {
        effect: 'allow',
        action: ['scf:UpdateTrigger'],
        resource: ['*'],
      },
      {
        effect: 'allow',
        action: ['scf:ListTriggers'],
        resource: [scfFunctionResource(config, config.functionName)],
      },
      {
        // CAM classifies InvokeFunction as operation-level, so its resource must remain "*".
        // https://intl.cloud.tencent.com/document/product/598/57149
        effect: 'allow',
        action: ['scf:InvokeFunction'],
        resource: ['*'],
      },
    ],
  }
}

export function schedulerScfCloudApiRequest(config, action, params) {
  if (!/^[a-z]{2,12}-[a-z0-9]{2,20}(?:-[a-z0-9]{1,20}){0,2}$/.test(text(config?.region))
    || !/^[a-z][a-z0-9]{1,80}$/i.test(text(action))
    || !params
    || typeof params !== 'object'
    || Array.isArray(params)) {
    throw new Error('Scheduler SCF Cloud API request is invalid')
  }
  return {
    service: 'scf',
    action,
    params,
    region: config.region,
  }
}

export function schedulerAdminRuntimeContract(environment, expected = {}) {
  const allowedAppIds = text(environment?.MIP_ALLOWED_APP_IDS)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const requiredAppId = text(expected.requiredAppId)
  const dispatchSecret = typeof environment?.MIP_MESSAGE_DISPATCH_HMAC_SECRET === 'string'
    ? environment.MIP_MESSAGE_DISPATCH_HMAC_SECRET
    : ''
  const outboxSecret = typeof environment?.MIP_OUTBOX_HMAC_SECRET === 'string'
    ? environment.MIP_OUTBOX_HMAC_SECRET
    : ''
  if (!allowedAppIds.length
    || allowedAppIds.some(value => !/^wx[0-9a-f]{16}$/i.test(value))
    || (requiredAppId && !allowedAppIds.includes(requiredAppId))
    || dispatchSecret.length < 32
    || dispatchSecret !== dispatchSecret.trim()
    || text(environment?.MIP_MESSAGE_SCHEDULER_FUNCTION_NAME) !== text(expected.schedulerFunctionName)
    || text(environment?.MIP_OUTBOX_FUNCTION_NAME) !== text(expected.outboxFunctionName)
    || outboxSecret.length < 32
    || outboxSecret !== outboxSecret.trim()) {
    throw new Error('Admin runtime is not ready for message scheduling automation')
  }
  return Object.freeze({ allowedAppIds: Object.freeze(allowedAppIds), dispatchSecret })
}

export function schedulerCreateFunctionRequest(config, environment, zipFile) {
  if (!config || !/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(config.functionName))
    || !/^[A-Z]\w{1,63}$/i.test(text(config.roleName))
    || text(config.roleName).toLowerCase() === 'tcb_qcsrole'
    || !/^[a-f0-9]{64}$/.test(text(environment?.MIP_MESSAGE_SCHEDULER_CODE_MARKER))
    || typeof zipFile !== 'string'
    || !/^[a-z0-9+/]+={0,2}$/i.test(zipFile)) {
    throw new Error('Scheduler raw SCF create request is invalid')
  }
  return {
    FunctionName: config.functionName,
    Namespace: config.envId,
    Code: { ZipFile: zipFile },
    CodeSource: 'ZipFile',
    Description: 'MIP single rolling message campaign timer',
    Environment: {
      Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })),
    },
    Handler: 'index.main',
    InstallDependency: 'TRUE',
    MemorySize: SCHEDULER_MEMORY_MB,
    Role: config.roleName,
    Runtime: SCHEDULER_RUNTIME,
    Timeout: SCHEDULER_TIMEOUT_SECONDS,
    Type: 'Event',
  }
}

export function schedulerSourceFingerprint(sourceRoot) {
  const root = path.resolve(sourceRoot)
  const hash = createHash('sha256')
  for (const relative of SCHEDULER_DEPLOYABLE_SOURCE_FILES) {
    const absolute = path.join(root, ...relative.split('/'))
    const stat = fs.lstatSync(absolute)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Scheduler deployable source must contain only regular allowlisted files')
    }
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(absolute))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function assertExistingSchedulerFunctionIdentity(existingFunction, config) {
  if (!existingFunction) {
    return null
  }
  const detail = functionDetail(existingFunction)
  const roleName = text(detail?.Role)
  const vpc = detail?.VpcConfig
  if (roleName !== config.roleName || roleName.toLowerCase() === 'tcb_qcsrole') {
    throw new Error('Existing scheduler function is not bound to the dedicated role')
  }
  if (vpc && (text(vpc.VpcId) || text(vpc.SubnetId))) {
    throw new Error('Scheduler must not be attached to the MySQL VPC')
  }
  return detail
}

export function assertSchedulerFunctionReadback(existingFunction, config, expectedEnvironment) {
  const detail = assertExistingSchedulerFunctionIdentity(existingFunction, config)
  if (!detail
    || detail.FunctionName !== config.functionName
    || detail.Namespace !== config.envId
    || detail.Status !== 'Active'
    || detail.AvailableStatus !== 'Available'
    || detail.Type !== 'Event'
    || detail.Runtime !== SCHEDULER_RUNTIME
    || detail.Handler !== 'index.main'
    || Number(detail.MemorySize) !== SCHEDULER_MEMORY_MB
    || Number(detail.Timeout) !== SCHEDULER_TIMEOUT_SECONDS) {
    throw new Error('Scheduler function configuration readback failed')
  }
  const actual = environmentVariables(detail)
  const actualEntries = Object.entries(actual).sort()
  const expectedEntries = Object.entries(expectedEnvironment).sort()
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)
    || !/^[a-f0-9]{64}$/.test(text(actual.MIP_MESSAGE_SCHEDULER_CODE_MARKER))
    || actual.MIP_DB_CONNECTION_URI) {
    throw new Error('Scheduler function environment readback failed')
  }
  return detail
}

export function schedulerTrustPolicy() {
  // Tencent SCF documents this exact service principal for function runtime roles.
  // https://intl.cloud.tencent.com/zh/document/product/583/38176
  return {
    version: '2.0',
    statement: [{
      effect: 'allow',
      action: 'name/sts:AssumeRole',
      principal: { service: [SCF_ROLE_SERVICE_PRINCIPAL] },
    }],
  }
}

export function scfFunctionResource(config, functionName) {
  return `qcs::scf:${config.region}:uin/${config.resourceUin}:namespace/${config.envId}/function/${functionName}`
}

export function exactPolicyFingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16)
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value
}

export function camRoleInfo(value) {
  const result = value?.Response || value?.data || value
  return result?.RoleInfo || result?.roleInfo || result
}

export function camPolicyDocument(value) {
  const result = value?.Response || value?.data || value
  return parsePolicyDocument(result?.PolicyDocument)
}

export function environmentVariables(detail) {
  const entries = functionDetail(detail)?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}

export function triggerList(value) {
  const candidates = [
    { list: value?.Triggers, total: value?.TotalCount },
    { list: value?.Response?.Triggers, total: value?.Response?.TotalCount },
    { list: value?.data?.Triggers, total: value?.data?.TotalCount },
    { list: value?.data?.triggers, total: value?.data?.totalCount },
  ]
  const inventory = candidates.find(item => Array.isArray(item.list) || item.total === 0)
  const list = Array.isArray(inventory?.list) ? inventory.list : []
  if (!inventory
    || !Number.isSafeInteger(inventory.total)
    || inventory.total !== list.length) {
    throw new Error('Scheduler trigger inventory could not be read')
  }
  return list
}

export function reservedConcurrency(value) {
  const candidates = [
    value?.ReservedMem,
    value?.ReservedConcurrencyMem,
    value?.Response?.ReservedMem,
    value?.Response?.ReservedConcurrencyMem,
    value?.data?.ReservedMem,
    value?.data?.ReservedConcurrencyMem,
  ]
  const result = candidates.map(Number).find(Number.isFinite)
  if (!Number.isFinite(result)) {
    throw new TypeError('Scheduler reserved concurrency could not be read')
  }
  return result
}

export function asyncEventRetryConfig(value) {
  const candidates = [
    value?.AsyncTriggerConfig,
    value?.Response?.AsyncTriggerConfig,
    value?.data?.AsyncTriggerConfig,
  ]
  const result = candidates.find(item => item && typeof item === 'object')
  const retry = Array.isArray(result?.RetryConfig)
    ? result.RetryConfig.find(item => Number.isSafeInteger(Number(item?.RetryNum))
      && Number(item.RetryNum) >= 0)
    : null
  const msgTtl = Number(result?.MsgTTL)
  const retryNum = Number(retry?.RetryNum)
  if (!Number.isSafeInteger(msgTtl) || !Number.isSafeInteger(retryNum)) {
    throw new TypeError('Scheduler async event retry configuration could not be read')
  }
  return { msgTtl, retryNum }
}

export function normalizeTriggerEnable(value) {
  if (value === 1 || value === '1') {
    return 'OPEN'
  }
  if (value === 0 || value === '0') {
    return 'CLOSE'
  }
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'OPEN' || normalized === 'CLOSE' ? normalized : ''
}

export function assertSingleSchedulerTrigger(triggers, config, { allowMissing = false } = {}) {
  if (!Array.isArray(triggers) || (allowMissing ? triggers.length > 1 : triggers.length !== 1)) {
    throw new Error('Scheduler function must contain exactly one fixed trigger')
  }
  const trigger = triggers[0]
  if (!trigger && !allowMissing) {
    throw new Error('Scheduler fixed trigger is missing')
  }
  if (trigger && (trigger.TriggerName !== config.triggerName
    || String(trigger.Type || '').toLowerCase() !== 'timer'
    || trigger.Qualifier !== '$DEFAULT')) {
    throw new Error('Scheduler fixed trigger identity is invalid')
  }
  return trigger || null
}

export function preflightSchedulerTriggerInventory(
  existingFunction,
  inventoryResponse,
  config,
  { allowMissingExisting = false } = {},
) {
  if (!existingFunction) {
    return Object.freeze({ exists: false, resumingMissingTrigger: false, trigger: null })
  }
  const trigger = assertSingleSchedulerTrigger(triggerList(inventoryResponse), config, {
    allowMissing: allowMissingExisting,
  })
  return Object.freeze({
    exists: true,
    resumingMissingTrigger: !trigger,
    trigger,
  })
}

export function parsePolicyDocument(value) {
  if (value && typeof value === 'object') {
    return value
  }
  if (typeof value !== 'string' || !value) {
    return null
  }
  for (const source of [value, decodeURIComponentSafe(value)]) {
    try {
      return JSON.parse(source)
    }
    catch {}
  }
  return null
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
