'use strict'

const operationManifests = require('./operations')

const EXPECTED_OPERATION_COUNT = 140
const OPERATION_KINDS = Object.freeze(['QUERY', 'MUTATION'])
const OPERATION_OWNERS = Object.freeze([
  'ACCESS',
  'USERS',
  'MEMBERSHIPS',
  'EVENTS',
  'ORDERS',
  'MESSAGING',
  'KNOWLEDGE',
  'OPPORTUNITIES',
  'GROWTH',
  'APPLICATION_WORKFLOW',
])
const healthOperation = Object.freeze({ action: 'health', owner: 'SYSTEM', kind: 'QUERY' })
const manifestKeys = new Set(['owner', 'operations'])
const operationKeys = new Set(['action', 'kind', 'dispatch', 'sessionFirst', 'wakesOutbox'])

function createOperationRegistry(manifests, options = {}) {
  const expectedCount = options.expectedCount ?? EXPECTED_OPERATION_COUNT
  const expectedOwners = options.expectedOwners ?? OPERATION_OWNERS
  if (!Array.isArray(manifests)
    || !Number.isInteger(expectedCount)
    || expectedCount < 1
    || !Array.isArray(expectedOwners)
    || expectedOwners.length < 1
    || new Set(expectedOwners).size !== expectedOwners.length
    || expectedOwners.some(owner => !OPERATION_OWNERS.includes(owner))) {
    throw new Error('OPERATION_REGISTRY_CONFIG_INVALID')
  }

  const expectedOwnerSet = new Set(expectedOwners)
  const manifestOwners = new Set()
  const actionNames = new Set()
  const operations = []

  for (const manifest of manifests) {
    if (!hasExactKeys(manifest, manifestKeys)
      || !OPERATION_OWNERS.includes(manifest.owner)
      || !expectedOwnerSet.has(manifest.owner)
      || !Array.isArray(manifest.operations)
      || manifest.operations.length < 1) {
      throw new Error('OPERATION_MANIFEST_INVALID')
    }
    if (manifestOwners.has(manifest.owner)) {
      throw new Error('OPERATION_OWNER_DUPLICATE')
    }
    manifestOwners.add(manifest.owner)

    for (const definition of manifest.operations) {
      if (!hasExactKeys(definition, operationKeys)) {
        throw new Error('OPERATION_DEFINITION_INVALID')
      }
      if (definition.action === 'health'
        || !/^mip\.admin\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(definition.action)) {
        throw new Error('OPERATION_ACTION_INVALID')
      }
      if (actionNames.has(definition.action)) {
        throw new Error('OPERATION_ACTION_DUPLICATE')
      }
      if (!OPERATION_KINDS.includes(definition.kind)) {
        throw new Error('OPERATION_KIND_INVALID')
      }
      if (typeof definition.dispatch !== 'function') {
        throw new TypeError('OPERATION_DISPATCH_INVALID')
      }
      if (typeof definition.sessionFirst !== 'boolean') {
        throw new Error('OPERATION_SESSION_INVALID')
      }
      if (typeof definition.wakesOutbox !== 'boolean'
        || (definition.wakesOutbox && definition.kind !== 'MUTATION')) {
        throw new Error('OPERATION_OUTBOX_INVALID')
      }

      actionNames.add(definition.action)
      operations.push(Object.freeze({
        action: definition.action,
        owner: manifest.owner,
        kind: definition.kind,
        dispatch: definition.dispatch,
        sessionFirst: definition.sessionFirst,
        wakesOutbox: definition.wakesOutbox,
      }))
    }
  }

  if (manifestOwners.size !== expectedOwnerSet.size
    || [...expectedOwnerSet].some(owner => !manifestOwners.has(owner))) {
    throw new Error('OPERATION_OWNER_MISSING')
  }
  if (operations.length !== expectedCount) {
    throw new Error('OPERATION_COUNT_INVALID')
  }

  const operationCatalog = Object.freeze(operations)
  const operationByAction = frozenRecord(
    operationCatalog.map(operation => [operation.action, operation]),
  )
  const actions = frozenRecord(
    operationCatalog.map(operation => [operation.action, operation.dispatch]),
  )
  const outboxMutationActions = new Set(
    operationCatalog.filter(operation => operation.wakesOutbox).map(operation => operation.action),
  )

  return Object.freeze({ actions, operationByAction, operationCatalog, outboxMutationActions })
}

function hasExactKeys(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const keys = Reflect.ownKeys(value)
  return keys.length === allowedKeys.size
    && keys.every(key => typeof key === 'string' && allowedKeys.has(key))
}

function frozenRecord(entries) {
  const record = Object.create(null)
  for (const [key, value] of entries) {
    record[key] = value
  }
  return Object.freeze(record)
}

const operationRegistry = createOperationRegistry(operationManifests)

module.exports = {
  EXPECTED_OPERATION_COUNT,
  OPERATION_KINDS,
  OPERATION_OWNERS,
  createOperationRegistry,
  healthOperation,
  operationByAction: operationRegistry.operationByAction,
  operationCatalog: operationRegistry.operationCatalog,
  operationRegistry,
  outboxMutationActions: operationRegistry.outboxMutationActions,
}
