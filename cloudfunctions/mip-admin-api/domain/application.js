'use strict'

const {
  createOperationDispatcher,
  operationRegistry,
} = require('./operation-registry')
const { AdminError } = require('./validation')

function createAdminApplication({ service, assertPrincipal, projectMedia = async value => value } = {}) {
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
    if (action === 'mip.admin.events.drafts.get') {
      if (!result.data) return result.data
      // Private draft JSON is client-controlled. Only repository-authorized previews may be signed.
      const { mediaPreviews } = await projectMedia({ mediaPreviews: result.data.mediaPreviews || [] })
      return { ...result.data, mediaPreviews }
    }
    return projectMedia(result.data)
  }

  async function probe() {
    return service.health()
  }

  return Object.freeze({ execute, probe })
}

module.exports = { createAdminApplication }
