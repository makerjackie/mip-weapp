'use strict'

const { EXPECTED_OPERATION_COUNT, operationCatalog } = require('./operation-registry')

const PUBLIC_OPERATION_CONTRACT_VERSION = 1

function createPublicOperationContract(operations = operationCatalog) {
  if (!Array.isArray(operations) || operations.length !== EXPECTED_OPERATION_COUNT) {
    throw new Error('PUBLIC_OPERATION_CONTRACT_SOURCE_INVALID')
  }

  const publicOperations = operations.map((operation) => {
    if (!operation
      || typeof operation.action !== 'string'
      || !['QUERY', 'MUTATION'].includes(operation.kind)
      || typeof operation.sessionFirst !== 'boolean') {
      throw new Error('PUBLIC_OPERATION_CONTRACT_SOURCE_INVALID')
    }

    return Object.freeze({
      action: operation.action,
      kind: operation.kind,
      authentication: 'REQUIRED',
      session: 'REQUIRED',
      // Read retries may append access-audit telemetry, but must not duplicate
      // business facts. Business writes remain MUTATION operations.
      safeToRetry: operation.kind === 'QUERY',
      idempotencyKeyRequired: null,
    })
  })

  return Object.freeze({
    version: PUBLIC_OPERATION_CONTRACT_VERSION,
    operationCount: publicOperations.length,
    operations: Object.freeze(publicOperations),
  })
}

const publicOperationContract = createPublicOperationContract()

module.exports = {
  PUBLIC_OPERATION_CONTRACT_VERSION,
  createPublicOperationContract,
  publicOperationContract,
}
