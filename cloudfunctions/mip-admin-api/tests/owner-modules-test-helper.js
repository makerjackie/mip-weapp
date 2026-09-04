'use strict'

const {
  OPERATION_OWNERS,
  operationCatalog,
} = require('../domain/operation-registry')
const { createAdminApplication } = require('../domain/application')
const { createHandler } = require('../domain/handler')

function createHandlerDouble({ service, getContext, issuePrincipal }) {
  const application = createAdminApplication({ service, assertPrincipal: principal => principal })
  return createHandler({ application, getContext, issuePrincipal })
}

function createOwnerModules(methods = {}, factory = () => async () => undefined) {
  const ownerModules = Object.fromEntries(OPERATION_OWNERS.map(owner => [owner, {}]))
  for (const operation of operationCatalog) {
    ownerModules[operation.owner][operation.method] = methods[operation.method] || factory(operation)
  }
  return ownerModules
}

function createServiceDouble(methods = {}, factory) {
  return {
    health: methods.health || (async () => ({ persistence: 'test' })),
    ownerModules: createOwnerModules(methods, factory),
  }
}

module.exports = { createHandlerDouble, createOwnerModules, createServiceDouble }
