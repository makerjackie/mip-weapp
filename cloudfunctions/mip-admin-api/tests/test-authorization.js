'use strict'

function authorization() {
  return {
    capability: 'test.mutation',
    effectiveGrant: {
      roleKey: 'PLATFORM_OWNER',
      scopeType: 'PLATFORM',
      scopeId: null,
    },
  }
}

async function authorizeMutation() {
  return authorization().effectiveGrant
}

function assertMutationScope() {}

async function lockMutation() {
  return authorization()
}

function withTestAuthorization(options = {}) {
  return {
    ...options,
    assertMutationScope,
    assertScope: assertMutationScope,
    authorizeMutation,
    lockMutation,
    lockMutationAuthorization: lockMutation,
  }
}

module.exports = {
  assertMutationScope,
  authorizeMutation,
  lockMutation,
  withTestAuthorization,
}
