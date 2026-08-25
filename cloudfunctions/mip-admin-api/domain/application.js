'use strict'

const { operationRegistry } = require('./operation-registry')
const { AdminError } = require('./validation')

const healthAction = service => service.health()
const actions = Object.freeze(Object.assign(
  Object.create(null),
  { health: healthAction },
  operationRegistry.actions,
))

function createAdminApplication({ service, assertPrincipal } = {}) {
  if (!service || typeof assertPrincipal !== 'function') {
    throw new Error('APPLICATION_CONFIG_INVALID')
  }

  async function execute(principal, action, input = {}) {
    const operation = operationRegistry.operationByAction[action]
    if (!operation) {
      throw new AdminError('NOT_FOUND', '运营操作不存在')
    }
    const caller = assertPrincipal(principal)
    return operation.dispatch(service, caller, input)
  }

  async function probe() {
    return healthAction(service)
  }

  return Object.freeze({ execute, probe })
}

module.exports = { actions, createAdminApplication }
