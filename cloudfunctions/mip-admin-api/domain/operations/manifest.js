'use strict'

function defineManifest(owner, operations) {
  return Object.freeze({
    owner,
    operations: Object.freeze([...operations]),
  })
}

function serviceOperation(action, kind, method, options = {}) {
  const sessionFirst = options.sessionFirst === true
  const wakesOutbox = options.wakesOutbox === true
  let dispatch
  if (sessionFirst) {
    dispatch = async (service, caller, input) => {
      await service.getSession(caller)
      return service[method](caller, input)
    }
  }
  else if (options.usesInput === false) {
    dispatch = (service, caller) => service[method](caller)
  }
  else {
    dispatch = (service, caller, input) => service[method](caller, input)
  }

  return Object.freeze({ action, kind, dispatch, sessionFirst, wakesOutbox })
}

module.exports = { defineManifest, serviceOperation }
