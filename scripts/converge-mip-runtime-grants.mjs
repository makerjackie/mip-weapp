#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  assertRuntimeAccountClaimable,
  assertRuntimePrivilegesExact,
  buildRuntimeGrantStatements,
  buildRuntimeRevokeStatements,
  parseGrantee,
  RUNTIME_TABLE_PRIVILEGES,
  runtimeUserForEnvironment,
} from './lib/mysql-privilege-assert.mjs'
import { loadRuntimeAccountSnapshot } from './lib/mysql-runtime-account-snapshot.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const confirmedEnv = argumentValue('--confirm-env=')
const runtimeUser = String(env.MIP_DB_RUNTIME_USER || runtimeUserForEnvironment(envId)).trim()
const confirmedRuntimeUser = argumentValue('--confirm-runtime-user=')
const connectionUri = String(env.MIP_DB_CONNECTION_URI || '').trim()

if (!envId || confirmedEnv !== envId) {
  throw new Error('MIP grant convergence requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (runtimeUser !== runtimeUserForEnvironment(envId) || confirmedRuntimeUser !== runtimeUser) {
  throw new Error('MIP grant convergence requires --confirm-runtime-user=<exact environment-scoped user>')
}

let parsedConnection
try {
  parsedConnection = new URL(connectionUri)
}
catch {
  throw new Error('MIP_DB_CONNECTION_URI must contain the existing dedicated runtime account')
}
const schema = decodeURIComponent(parsedConnection.pathname.replace(/^\//, ''))
if (parsedConnection.protocol !== 'mysql:'
  || decodeURIComponent(parsedConnection.username) !== runtimeUser
  || !parsedConnection.password
  || !parsedConnection.hostname
  || !/^[\w-]+$/.test(schema)) {
  throw new Error('MIP_DB_CONNECTION_URI does not match the confirmed MIP runtime account')
}

bindAndRequireMysqlEnvironment(root, envId)
const grantee = parseGrantee(runtimeUser, '%')
const snapshot = loadRuntimeAccountSnapshot(root, grantee)
const claim = assertRuntimeAccountClaimable({
  ...snapshot,
  schema,
  grantee,
  allowExisting: true,
})

try {
  assertRuntimePrivilegesExact({
    ...snapshot,
    requiredMap: RUNTIME_TABLE_PRIVILEGES,
    grantee,
  })
  console.log(`[mip-db-grants] exact table grants already current (${Object.keys(RUNTIME_TABLE_PRIVILEGES).length} tables)`)
  process.exit(0)
}
catch {}

for (const sql of [
  ...buildRuntimeRevokeStatements(schema, grantee, claim.tableRows),
  ...buildRuntimeGrantStatements(schema, grantee),
]) {
  const result = callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql,
  }, 300000)
  if (result?.success === false || result?.isError === true) {
    throw new Error('CloudBase MySQL rejected exact MIP runtime grant convergence')
  }
}

assertRuntimePrivilegesExact({
  ...loadRuntimeAccountSnapshot(root, grantee),
  requiredMap: RUNTIME_TABLE_PRIVILEGES,
  grantee,
})
console.log(`[mip-db-grants] exact table grants converged (${Object.keys(RUNTIME_TABLE_PRIVILEGES).length} tables)`)

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || ''
}
