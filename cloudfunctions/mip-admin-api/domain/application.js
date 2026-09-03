'use strict'

const {
  createOperationDispatcher,
  operationRegistry,
} = require('./operation-registry')
const { AdminError } = require('./validation')

function createAdminApplication({ service, assertPrincipal } = {}) {
  if (!service
    || typeof service.health !== 'function'
    || typeof assertPrincipal !== 'function') {
    throw new Error('APPLICATION_CONFIG_INVALID')
  }
  const dispatcher = createOperationDispatcher(service.ownerModules)

  async function execute(principal, action, input = {}) {
    const operation = operationRegistry.operationByAction[action]
    if (!operation) {
      throw new AdminError('NOT_FOUND', '运营操作不存在')
    }
    const caller = assertPrincipal(principal)
    const result = await dispatcher.execute(caller, action, input)
    return result.data
  }

  async function probe() {
    return service.health()
  }

  return Object.freeze({ execute, probe })
}

module.exports = { createAdminApplication }
