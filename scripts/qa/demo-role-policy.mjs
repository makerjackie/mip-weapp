import assert from 'node:assert/strict'

const roleIds = { 'member': 1, 'player': 1, 'ordinary': 4, 'guest': 3, 'renewal': 1, 'visitor': null, 'new-user': 4 }

export function requireTestEnvironment(env) {
  assert(['development', 'test', 'staging'].includes(env.MIP_DEPLOYMENT_STAGE), 'Requires non-production environment')
  assert.equal(env.MIP_CATALOG_STAGE, 'TEST', 'Requires TEST catalog')
  assert.notEqual(env.MIP_PAYMENT_MODE, 'live', 'Live payment is forbidden')
}

export function demoUserId(role) {
  if (!Object.hasOwn(roleIds, role)) {
    throw new Error('QA_UNSUPPORTED_ROLE')
  }
  const number = roleIds[role]
  return number ? `50000000-0000-4000-8000-00000000000${number}` : undefined
}
