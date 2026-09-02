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
  const usesInput = options.usesInput !== false

  return Object.freeze({ action, kind, method, sessionFirst, usesInput, wakesOutbox })
}

module.exports = { defineManifest, serviceOperation }
