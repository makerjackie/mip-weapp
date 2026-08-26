#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  assertMembershipChainInvariant,
  assertMembershipChainReconcileConfirmation,
  MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL,
  MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL,
  parseMembershipChainInvariant,
} from './lib/membership-chain-reconcile.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
assertMembershipChainReconcileConfirmation({
  envId,
  confirmedEnv: argumentValue('--confirm-env='),
  confirmedPrefix: argumentValue('--confirm-prefix='),
})

bindAndRequireMysqlEnvironment(root, envId)
const before = parseMembershipChainInvariant(queryInvariant())
if (before.orphanChains !== 0) {
  throw new Error('Membership-chain reconcile found orphan rows; no writes were attempted')
}

const result = callCloudbase(root, 'manageMysqlDatabase', {
  action: 'runStatement',
  sql: MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL,
}, 300000)
if (result?.success === false || result?.isError === true) {
  throw new Error('Membership-chain reconcile statement was rejected')
}

const after = assertMembershipChainInvariant(queryInvariant())
console.log(JSON.stringify({
  usersVerified: after.userCount,
  chainsVerified: after.chainCount,
  missingChainsReconciled: before.missingChains,
  idempotent: true,
}, null, 2))

function queryInvariant() {
  return callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL,
  })
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || ''
}
