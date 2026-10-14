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
  buildRuntimePrivilegeDeltaStatements,
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
const configuredSchemaName = String(env.MIP_DB_SCHEMA || '').trim()
const confirmedSchema = argumentValue('--confirm-schema=')
if (configuredSchemaName && confirmedSchema && configuredSchemaName !== confirmedSchema) {
  throw new Error('MIP_DB_SCHEMA and --confirm-schema disagree on the target schema')
}

if (!envId || confirmedEnv !== envId) {
  throw new Error('MIP grant convergence requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (confirmedRuntimeUser !== runtimeUser) {
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
// The connection schema decides which derivation is legitimate: the instance
// default keeps the envId-only account; a confirmed second schema must use the
// schema-salted account so two logical databases never share a runtime user.
const confirmedTargetSchema = confirmedSchema || configuredSchemaName || ''
const expectedUser = confirmedTargetSchema === schema && confirmedTargetSchema
  ? runtimeUserForEnvironment(envId, schema)
  : runtimeUserForEnvironment(envId)
if (runtimeUser !== expectedUser) {
  throw new Error('MIP grant convergence requires the schema-scoped runtime user; pass --confirm-schema=<exact schema> for a second logical database')
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

const changes = buildRuntimePrivilegeDeltaStatements(schema, grantee, claim.tableRows)
console.log(`[mip-db-grants] applying ${changes.length} privilege differences; preserving matching grants`)
let completed = 0
for (const sql of changes) {
  const result = callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql,
  }, 300000)
  if (result?.success === false || result?.isError === true) {
    throw new Error('CloudBase MySQL rejected exact MIP runtime grant convergence')
  }
  completed += 1
  if (completed % 10 === 0 || completed === changes.length) {
    console.log(`[mip-db-grants] applied ${completed}/${changes.length} differences`)
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
