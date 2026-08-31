#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  cloudFunctionResult,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'
import {
  buildOwnerCandidateQuery,
  currentAgreementVersions,
  resolveOwnerPhoneHash,
  selectOwnerCandidateId,
} from './lib/mip-owner-bootstrap.mjs'
import {
  assertDeployedOwnerTestMembership,
  ownerTestMembershipSummary,
  resolveOwnerTestMembershipCommand,
} from './lib/mip-owner-test-membership.mjs'

const require = createRequire(import.meta.url)
const { signInternalRequest } = require('../cloudfunctions/mip-payment-ledger/lib/internal-auth')

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8'))
const demoUserIds = (Array.isArray(seed?.users) ? seed.users : [])
  .map(item => String(item?.id || ''))
  .filter(Boolean)
const functionName = resolveMipFunctionNames(env).ledger
const command = resolveOwnerTestMembershipCommand({
  args: process.argv.slice(2),
  env,
  functionName,
})

bindAndRequireMysqlEnvironment(root, command.envId, {
  development: ['development', 'test'].includes(command.deploymentStage),
  stage: command.deploymentStage,
})
const ownerPhoneHash = resolveOwnerPhoneHash({
  appId: command.appId,
  ownerPhone: env.MIP_OWNER_PHONE,
  phoneEncryptionKey: env.MIP_PHONE_ENCRYPTION_KEY,
})
const agreements = currentAgreementVersions(env.MIP_AGREEMENTS_JSON)
const candidates = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildOwnerCandidateQuery({
    agreements,
    appId: command.appId,
    demoUserIds,
    phoneHash: ownerPhoneHash,
  }),
  limit: 2,
})
selectOwnerCandidateId(candidates)
const detail = callCloudbase(root, 'callCloudApi', {
  service: 'scf',
  action: 'GetFunction',
  params: { FunctionName: functionName, Namespace: command.envId, ShowCode: 'FALSE' },
})
const secret = assertDeployedOwnerTestMembership(command, environmentVariables(detail))
const request = {
  action: command.action,
  appId: command.appId,
  signedAt: Date.now(),
  nonce: randomBytes(16).toString('hex'),
  planKey: command.planKey,
}
const response = callCloudbase(root, 'manageFunctions', {
  action: 'invokeFunction',
  functionName,
  params: { ...request, signature: signInternalRequest(request, secret) },
}, 120000)
const result = cloudFunctionResult(response)
if (result?.ok !== true) {
  throw new Error(result?.error?.code || 'Owner TEST membership invocation failed')
}
console.log(JSON.stringify(ownerTestMembershipSummary(command.operation, result.data), null, 2))

function environmentVariables(value) {
  const detail = value?.data?.functionDetail || value?.Response || value?.data || value
  const entries = detail?.Environment?.Variables
  if (!Array.isArray(entries)) {
    return {}
  }
  return Object.fromEntries(entries
    .filter(item => typeof item?.Key === 'string' && typeof item?.Value === 'string')
    .map(item => [item.Key, item.Value]))
}
