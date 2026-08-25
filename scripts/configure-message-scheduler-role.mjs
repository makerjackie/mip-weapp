#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { bindAndRequireCloudbaseEnvironment, callCloudbase, loadCaseEnv } from './lib/example-cloudbase.mjs'
import {
  camPolicyDocument,
  camRoleInfo,
  canonicalJson,
  exactPolicyFingerprint,
  parsePolicyDocument,
  schedulerCloudConfig,
  schedulerRuntimePolicy,
  schedulerTrustPolicy,
} from './lib/message-scheduler-cloud.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'
import { resolveMipFunctionNames } from './lib/mip-function-names.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const functionNames = resolveMipFunctionNames(env)
const config = schedulerCloudConfig(env, functionNames)
const apply = process.argv.includes('--apply')
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, process.argv.slice(2))

assertConfirmations(config)
bindAndRequireCloudbaseEnvironment(root, config.envId)

const expectedPolicy = schedulerRuntimePolicy(config)
const expectedTrust = schedulerTrustPolicy()
if (!apply) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    role: config.roleName,
    policy: config.policyName,
    policyFingerprint: exactPolicyFingerprint(expectedPolicy),
    permissions: ['scf:UpdateTrigger', 'scf:ListTriggers', 'scf:InvokeFunction'],
    touchesSharedTcbRole: false,
  }, null, 2))
  process.exit(0)
}

let role = getRole(config.roleName)
if (!role) {
  callCam('CreateRole', {
    RoleName: config.roleName,
    PolicyDocument: JSON.stringify(expectedTrust),
    Description: 'MIP rolling message timer runtime role',
  })
  role = getRole(config.roleName)
}
assertRole(role, config, expectedTrust)
const attachedBefore = attachedPolicies(config.roleName)
if (attachedBefore.some(item => item.PolicyName !== config.policyName)) {
  throw new Error('Scheduler role has an unexpected attached policy; it was not modified')
}

let policy = findLocalPolicy(config.policyName)
if (!policy) {
  callCam('CreatePolicy', {
    PolicyName: config.policyName,
    PolicyDocument: JSON.stringify(expectedPolicy),
    Description: 'Minimum runtime access for the MIP rolling message timer',
  })
  policy = findLocalPolicy(config.policyName)
}
assertPolicy(policy, expectedPolicy)

if (!attachedBefore.some(item => Number(item.PolicyId) === Number(policy.PolicyId))) {
  callCam('AttachRolePolicy', {
    AttachRoleName: config.roleName,
    PolicyId: Number(policy.PolicyId),
  })
}
const attachedReadback = attachedPolicies(config.roleName)
if (attachedReadback.length !== 1
  || Number(attachedReadback[0].PolicyId) !== Number(policy.PolicyId)) {
  throw new Error('Scheduler policy attachment readback failed')
}
console.log(JSON.stringify({
  mode: 'applied',
  role: config.roleName,
  policy: config.policyName,
  policyFingerprint: exactPolicyFingerprint(expectedPolicy),
  touchesSharedTcbRole: false,
}, null, 2))

function assertConfirmations(value) {
  if (argumentValue('--confirm-env=') !== value.envId
    || argumentValue('--confirm-function=') !== value.functionName
    || argumentValue('--confirm-role=') !== value.roleName
    || argumentValue('--confirm-resource-uin=') !== value.resourceUin) {
    throw new Error('Scheduler role setup requires exact environment, function, role, and resource owner confirmations')
  }
}

function getRole(roleName) {
  try {
    return camRoleInfo(callCam('GetRole', { RoleName: roleName }))
  }
  catch (error) {
    if (/not found|not exist|resourcenotfound|不存在|未找到/i.test(String(error?.message || error))) {
      return null
    }
    throw error
  }
}

function assertRole(role, value, expectedTrust) {
  if (!role || role.RoleName !== value.roleName) {
    throw new Error('Scheduler role readback failed')
  }
  const trust = parsePolicyDocument(role.PolicyDocument)
  if (!trust || canonicalJson(trust) !== canonicalJson(expectedTrust)) {
    throw new Error('Existing scheduler role trust policy drifted; it was not modified')
  }
}

function findLocalPolicy(policyName) {
  const result = response(callCam('ListPolicies', {
    Scope: 'Local',
    Page: 1,
    Rp: 200,
    Keyword: policyName,
  }))
  const list = result?.List || result?.PolicyList || []
  const matches = list.filter(item => item.PolicyName === policyName)
  if (matches.length > 1) {
    throw new Error('Scheduler policy lookup is ambiguous')
  }
  return matches[0] || null
}

function assertPolicy(policy, expected) {
  if (!policy || !Number.isSafeInteger(Number(policy.PolicyId))) {
    throw new Error('Scheduler policy readback failed')
  }
  const document = camPolicyDocument(callCam('GetPolicy', {
    PolicyId: Number(policy.PolicyId),
  }))
  if (!document || canonicalJson(document) !== canonicalJson(expected)) {
    throw new Error('Existing scheduler policy drifted; it was not modified')
  }
}

function attachedPolicies(roleName) {
  const result = response(callCam('ListAttachedRolePolicies', { RoleName: roleName, Page: 1, Rp: 200 }))
  return result?.List || result?.PolicyList || []
}

function callCam(action, params) {
  return callCloudbase(root, 'callCloudApi', { service: 'cam', action, params })
}

function response(value) {
  return value?.Response || value?.data || value
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}
