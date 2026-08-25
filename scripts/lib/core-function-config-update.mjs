const CONFIGURATION_PARAM_ALLOWLIST = new Set([
  'Environment',
  'FunctionName',
  'Namespace',
  'Timeout',
])

export function functionConfigurationSnapshot(detail) {
  const value = functionDetail(detail)
  if (!value || typeof value !== 'object') {
    throw new Error('Cloud Function configuration readback is missing')
  }
  return Object.freeze({
    environment: Object.freeze(environmentVariables(value)),
    handler: text(value.Handler),
    role: text(value.Role),
    runtime: text(value.Runtime),
    subnetId: text(value.VpcConfig?.SubnetId),
    timeout: Number(value.Timeout),
    vpcId: text(value.VpcConfig?.VpcId),
  })
}

export function planExistingFunctionConfigurationUpdate({
  current,
  expected,
  functionName,
  namespace,
  region,
}) {
  assertFunctionName(functionName)
  assertNamespace(namespace)
  assertConfiguration('current', current)
  assertConfiguration('expected', expected)

  if (current.runtime !== expected.runtime) {
    throw new Error(`${functionName} runtime drift must be resolved before deployment`)
  }
  if (current.vpcId !== expected.vpcId || current.subnetId !== expected.subnetId) {
    throw new Error(`${functionName} VPC configuration drift; refusing to update code or configuration`)
  }
  if (current.role !== expected.role) {
    throw new Error(`${functionName} execution role drift; refusing to update code or configuration`)
  }

  const environmentChanged = !sameEnvironment(current.environment, expected.environment)
  const handlerChanged = current.handler !== expected.handler
  const timeoutChanged = current.timeout !== expected.timeout
  let configurationCall = null

  if (environmentChanged || timeoutChanged) {
    const normalizedRegion = assertScfRegion(region)
    const variables = sortedEnvironmentVariables(expected.environment)
    const params = {
      FunctionName: functionName,
      Namespace: namespace,
      Environment: Object.freeze({ Variables: variables }),
      ...(timeoutChanged ? { Timeout: expected.timeout } : {}),
    }
    assertConfigurationRequestAllowlist(params)
    configurationCall = Object.freeze({
      action: 'UpdateFunctionConfiguration',
      params: Object.freeze(params),
      region: normalizedRegion,
      service: 'scf',
    })
  }

  return Object.freeze({
    before: current,
    configurationCall,
    environmentChanged,
    handlerChanged,
    timeoutChanged,
  })
}

export function assertScfRegion(value) {
  const region = text(value)
  if (!/^[a-z]{2,12}-[a-z0-9]{2,20}(?:-[a-z0-9]{1,20}){0,2}$/.test(region)) {
    throw new Error('SCF region is required for configuration updates')
  }
  return region
}

export function assertExistingFunctionAfterConfiguration({ actual, before, expected, functionName }) {
  if (!existingFunctionConfigurationConverged({ actual, before, expected, functionName })) {
    throw new Error(`${functionName} configuration readback did not converge`)
  }
}

export function existingFunctionConfigurationConverged({ actual, before, expected, functionName }) {
  assertFunctionName(functionName)
  assertConfiguration('configuration readback', actual)
  assertConfiguration('configuration baseline', before)
  assertConfiguration('expected configuration', expected)
  assertStableNetworkAndRole(actual, before, expected, functionName)
  if (actual.runtime !== expected.runtime) {
    throw new Error(`${functionName} runtime changed during configuration update`)
  }
  if (actual.handler !== before.handler) {
    throw new Error(`${functionName} handler changed during configuration update`)
  }
  return actual.timeout === expected.timeout
    && sameEnvironment(actual.environment, expected.environment)
}

export function assertExistingFunctionAfterCode({ actual, before, expected, functionName }) {
  if (!existingFunctionCodeConverged({ actual, before, expected, functionName })) {
    throw new Error(`${functionName} code readback did not converge`)
  }
}

export function existingFunctionCodeConverged({ actual, before, expected, functionName }) {
  assertFunctionName(functionName)
  assertConfiguration('code readback', actual)
  assertConfiguration('configuration baseline', before)
  assertConfiguration('expected configuration', expected)
  assertStableNetworkAndRole(actual, before, expected, functionName)
  if (actual.runtime !== expected.runtime) {
    throw new Error(`${functionName} runtime changed during code update`)
  }
  return actual.handler === expected.handler
    && actual.timeout === expected.timeout
    && sameEnvironment(actual.environment, expected.environment)
}

function assertStableNetworkAndRole(actual, before, expected, functionName) {
  if (actual.vpcId !== before.vpcId
    || actual.subnetId !== before.subnetId
    || actual.vpcId !== expected.vpcId
    || actual.subnetId !== expected.subnetId) {
    throw new Error(`${functionName} VPC configuration changed during deployment`)
  }
  if (actual.role !== before.role || actual.role !== expected.role) {
    throw new Error(`${functionName} execution role changed during deployment`)
  }
}

function assertConfiguration(label, value) {
  if (!value
    || typeof value !== 'object'
    || !value.environment
    || typeof value.environment !== 'object'
    || Array.isArray(value.environment)
    || typeof value.handler !== 'string'
    || !value.handler
    || typeof value.runtime !== 'string'
    || !value.runtime
    || typeof value.vpcId !== 'string'
    || !value.vpcId
    || typeof value.subnetId !== 'string'
    || !value.subnetId
    || !Number.isInteger(value.timeout)
    || value.timeout < 1
    || typeof value.role !== 'string'
    || !value.role) {
    throw new Error(`${label} Cloud Function configuration is invalid`)
  }
  for (const [key, environmentValue] of Object.entries(value.environment)) {
    if (!/^[a-z]\w{0,127}$/i.test(key) || typeof environmentValue !== 'string') {
      throw new Error(`${label} Cloud Function environment is invalid`)
    }
  }
}

function assertConfigurationRequestAllowlist(params) {
  if (Object.keys(params).some(key => !CONFIGURATION_PARAM_ALLOWLIST.has(key))) {
    throw new Error('SCF configuration request contains an unsupported field')
  }
}

function assertFunctionName(value) {
  if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(text(value))) {
    throw new Error('MIP Cloud Function name is invalid')
  }
}

function assertNamespace(value) {
  if (!/^(?!_)\w[\w-]{0,127}$/.test(text(value))) {
    throw new Error('SCF namespace is invalid')
  }
}

function environmentVariables(value) {
  const entries = value?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  const result = {}
  for (const item of entries) {
    if (typeof item?.Key !== 'string' || typeof item?.Value !== 'string' || item.Key in result) {
      throw new Error('Cloud Function environment readback is invalid')
    }
    result[item.Key] = item.Value
  }
  return result
}

function functionDetail(value) {
  return value?.data?.functionDetail || value?.Response || value?.data || value
}

function sameEnvironment(left, right) {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function sortedEnvironmentVariables(environment) {
  return Object.freeze(Object.entries(environment)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([Key, Value]) => Object.freeze({ Key, Value })))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
