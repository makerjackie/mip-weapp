import { isDeepStrictEqual } from 'node:util'

const AUTHENTICATED_INVOKE_RULE = 'auth.loginType != \'ANONYMOUS\' && auth != null'

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseFunctionSecurityRules(securityRule) {
  if (typeof securityRule !== 'string' || !securityRule.trim()) {
    throw new Error('Cloud Function security rules are unavailable; refusing to replace shared environment rules')
  }
  let rules
  try {
    rules = JSON.parse(securityRule)
  }
  catch {
    throw new Error('Cloud Function security rules are invalid; refusing to replace shared environment rules')
  }
  if (!plainObject(rules)
    || !plainObject(rules['*'])
    || !Object.hasOwn(rules['*'], 'invoke')) {
    throw new Error('Cloud Function security rules are incomplete; shared wildcard rule is required')
  }
  return rules
}

export function updateMipFunctionInvocationRule(rules, functionName, invoke) {
  if (!plainObject(rules) || !/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(functionName)) {
    throw new Error('Only a parsed shared rule set and a lowercase mip-* function may be updated')
  }
  if (![true, false, 'auth != null', AUTHENTICATED_INVOKE_RULE].includes(invoke)) {
    throw new Error('Unsupported Cloud Function invocation rule')
  }
  return {
    ...rules,
    [functionName]: { invoke },
  }
}

export function assertFunctionSecurityRulesConverged({
  before,
  after,
  functionName,
  invoke,
}) {
  if (!plainObject(before) || !plainObject(after)) {
    throw new Error('Cloud Function security rule readback is unavailable')
  }
  if (after?.[functionName]?.invoke !== invoke) {
    throw new Error(`${functionName} client invocation rule did not converge`)
  }

  const beforeKeys = Object.keys(before).filter(key => key !== functionName).sort()
  const afterKeys = Object.keys(after).filter(key => key !== functionName).sort()
  if (!isDeepStrictEqual(beforeKeys, afterKeys)) {
    throw new Error('Cloud Function security rule update changed unrelated shared entries')
  }
  for (const key of beforeKeys) {
    if (!isDeepStrictEqual(before[key], after[key])) {
      throw new Error('Cloud Function security rule update changed an unrelated shared entry')
    }
  }
}

function field(value, names) {
  if (!plainObject(value)) {
    return undefined
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  const entry = Object.entries(value).find(([key]) => expected.has(key.toLowerCase()))
  return entry?.[1]
}

export function collectTimerTriggers(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTimerTriggers(item, output)
    }
    return output
  }
  if (!plainObject(value)) {
    return output
  }

  const type = field(value, ['type', 'triggerType', 'trigger_type'])
  if (String(type || '').trim().toLowerCase() === 'timer') {
    output.push({
      name: String(field(value, ['triggerName', 'trigger_name', 'name']) || '').trim(),
    })
    return output
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectTimerTriggers(child, output)
    }
  }
  return output
}

export function assertNoTimerTriggers(functionName, response) {
  const inventory = findTriggerInventory(response)
  if (!inventory) {
    throw new Error(`${functionName} trigger inventory is unavailable; refusing to assume timers are absent`)
  }
  if (!Number.isSafeInteger(inventory.total) || inventory.total < 0) {
    throw new Error(`${functionName} trigger inventory count is invalid`)
  }
  if (inventory.total !== inventory.triggers.length) {
    throw new Error(`${functionName} trigger inventory is incomplete; refusing to assume timers are absent`)
  }
  if (collectTimerTriggers(inventory.triggers).length > 0) {
    throw new Error(`${functionName} must not have timer triggers because it can keep shared resources active`)
  }
}

export function assertNoTriggers(functionName, response) {
  const inventory = findTriggerInventory(response)
  if (!inventory) {
    throw new Error(`${functionName} trigger inventory is unavailable; refusing to assume triggers are absent`)
  }
  if (!Number.isSafeInteger(inventory.total) || inventory.total < 0) {
    throw new Error(`${functionName} trigger inventory count is invalid`)
  }
  if (inventory.total !== inventory.triggers.length) {
    throw new Error(`${functionName} trigger inventory is incomplete; refusing to assume triggers are absent`)
  }
  if (inventory.total !== 0) {
    throw new Error(`${functionName} must not have triggers`)
  }
}

function findTriggerInventory(value) {
  if (!plainObject(value)) {
    return null
  }
  const triggerEntry = Object.entries(value)
    .find(([key]) => key.toLowerCase() === 'triggers')
  if (triggerEntry) {
    const triggers = triggerEntry[1]
    const total = Number(field(value, ['totalCount', 'total_count']))
    return Array.isArray(triggers) ? { total, triggers } : null
  }
  for (const child of Object.values(value)) {
    const inventory = findTriggerInventory(child)
    if (inventory) {
      return inventory
    }
  }
  return null
}

export { AUTHENTICATED_INVOKE_RULE }
