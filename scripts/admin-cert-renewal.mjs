#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { assertRenewalRoleEvidence, ensureRenewalLogs, ensureRenewalRole, renewalCloudConfig, renewalCron, renewalPolicy } from './lib/admin-cert-renewal-cloud.mjs'
import { assertFunctionSecurityRulesConverged, parseFunctionSecurityRules, updateMipFunctionInvocationRule } from './lib/cloud-function-safety.mjs'
import { parseMcpOutput, runMcporter } from './lib/cloudbase-mcp-runner.mjs'
import { bindAndRequireCloudbaseEnvironment, callCloudbase, loadCaseEnv } from './lib/example-cloudbase.mjs'
import { canonicalJson, environmentVariables, exactPolicyFingerprint, functionDetail, normalizeTriggerEnable, triggerList } from './lib/message-scheduler-cloud.mjs'
import { resolveMipDeploymentStage } from './lib/mip-deployment-stage.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const { createCloudApi } = require('../cloudfunctions/mip-admin-cert-renewer/cloud-api.js')
const { domainConfig, signRequest, readConfig } = require('../cloudfunctions/mip-admin-cert-renewer/renewal.js')
const { oneShotCron } = require('../cloudfunctions/mip-message-scheduler/lib/trigger-controller.js')

const env = loadCaseEnv(root)
const args = process.argv.slice(2)
const command = args.find(value => !value.startsWith('--'))
if (!['prepare', 'logs', 'role', 'deploy', 'pause', 'canary', 'activate', 'check', 'force', 'status'].includes(command)) {
  throw new Error('Choose prepare, logs, role, deploy, pause, canary, activate, check, force or status')
}
const argument = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const domain = argument('domain')
if (!/^admin\.[a-z0-9.-]+$/.test(domain || '') || argument('confirm-env') !== env.CLOUDBASE_ENV_ID
  || argument('confirm-function') !== 'mip-admin-cert-renewer') {
  throw new Error('Exact domain, environment and dedicated function confirmations required')
}
resolveMipDeploymentStage(env.MIP_DEPLOYMENT_STAGE, args)
const info = bindAndRequireCloudbaseEnvironment(root, env.CLOUDBASE_ENV_ID)
const directory = path.join(root, '.tmp', `admin-cert-renewal-${domain}`)
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
const configPath = path.join(directory, 'config.private.json')
const privateJson = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 })
// CloudBase namespaces require this SCF stamp even with ordinary API v3 calls.
// https://cloud.tencent.com/document/product/876/34808
function call(service, action, params, timeout = 60000) {
  const request = { service, action, params: service === 'scf' && action === 'CreateFunction' ? { Stamp: 'MINI_QCBASE', ...params } : params, ...(service === 'scf' ? { region: info.Region } : {}) }
  const raw = runMcporter(root, ['call', 'cloudbase.callCloudApi', '--args', JSON.stringify(request), '--output', 'json', '--timeout', String(timeout)], timeout + 5000)
  fs.writeFileSync(path.join(directory, `${service}-${action}.private.json`), raw, { mode: 0o600 })
  return parseMcpOutput(raw)
}
const unwrap = value => value?.Response || value?.data?.raw || value?.data || value
let detail = getFunction()
const existingEnv = detail ? environmentVariables(detail) : null
const saved = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null
const logsPath = path.join(directory, 'dedicated-logs.private.json')
const logReceipt = fs.existsSync(logsPath) ? JSON.parse(fs.readFileSync(logsPath, 'utf8')) : null
if (logReceipt && (logReceipt.domain !== domain || logReceipt.envId !== info.EnvId || logReceipt.region !== info.Region || logReceipt.resourceUin !== String(info.UserInfo?.Uin) || logReceipt.period !== 7)) {
  throw new Error('Dedicated log receipt identity drifted')
}
const selectedLog = logReceipt ? { TopicId: logReceipt.logTopicId, LogsetId: logReceipt.logsetId, Region: logReceipt.region } : detail?.Status === 'Active' && detail.ClsTopicId ? { TopicId: detail.ClsTopicId, LogsetId: detail.ClsLogsetId, Region: info.Region } : undefined
const config = renewalCloudConfig(env, info, domain, existingEnv?.MIP_ADMIN_CERT_TRIGGER_SECRET || saved?.secret || randomBytes(32).toString('hex'), existingEnv?.MIP_ADMIN_CERT_GENERATION || saved?.generation || randomBytes(16).toString('hex'), selectedLog)
const migrateLog = saved && (!saved.logTopicId || (logReceipt && saved.logTopicId === info.LogServices?.[0]?.TopicId && saved.logsetId === info.LogServices?.[0]?.LogsetId))
const previousConfig = migrateLog ? { ...saved, logTopicId: config.logTopicId, logsetId: config.logsetId } : saved
if (saved && canonicalJson(previousConfig) !== canonicalJson(config)) {
  throw new Error('Saved renewal configuration drifted')
}
privateJson('config.private.json', config)
const gateway = unwrap(call('tcb', 'DescribeHTTPServiceRoute', { EnvId: config.envId }))
domainConfig(gateway, config)
privateJson('gateway.private.json', gateway)
const files = ['index.js', 'cloud-api.js', 'renewal.js', 'package.json']
const source = path.join(root, 'cloudfunctions', config.functionName)
const marker = createHash('sha256').update(files.map(file => `${file}\0${fs.readFileSync(path.join(source, file), 'utf8')}`).join('\0')).digest('hex')
const report = { function: config.functionName, domain, role: config.roleName, policyFingerprint: exactPolicyFingerprint(renewalPolicy(config)), sourceFingerprint: marker, databaseAccess: false }

if (command === 'prepare') {
  privateJson('policy.private.json', renewalPolicy(config))
  console.log(JSON.stringify({ ...report, status: 'PREPARED', commands: ['role', 'deploy', 'canary', 'activate', 'check'] }, null, 2))
}
else if (command === 'role') {
  verifyRole()
  console.log(JSON.stringify({ ...report, status: 'ROLE_VERIFIED' }))
}
else if (command === 'logs') {
  if (argument('confirm-log-resources') !== domain) {
    throw new Error('Exact dedicated log creation confirmation required')
  }
  const { credentials } = callCloudbase(root, 'auth', { action: 'get_temp_credentials', confirm: 'yes', reveal: true })
  const cloud = createCloudApi(credentials, config.region, fetch, { cls: { version: '2020-10-16', actions: ['DescribeLogsets', 'DescribeTopics', 'CreateLogset', 'CreateTopic'] } })
  privateJson('dedicated-logs.private.json', await ensureRenewalLogs(config, cloud))
  console.log(JSON.stringify({ ...report, status: 'DEDICATED_LOGS_VERIFIED', period: 7 }))
}
else if (command === 'deploy') {
  verifyRole()
  if (detail) {
    assertDetail(detail)
    if (listTriggers().some(trigger => normalizeTriggerEnable(trigger.Enable) !== 'CLOSE')) {
      throw new Error('Pause and read back the existing dedicated timer before redeploying')
    }
    privateJson('function-before.private.json', detail)
    if (detail.Status === 'CreateFailed') {
      if (listTriggers().length) {
        throw new Error('Failed creation is not the exact inactive source owned by this deployment')
      }
      // SCF refuses GetFunctionAddress for CreateFailed. Preserve and verify
      // the exact local creation archive; never use this exception for Active.
      const failedArchive = path.join(directory, 'function.zip')
      const previousFiles = []
      for (const file of files) {
        const content = spawnSync('unzip', ['-p', failedArchive, file], { maxBuffer: 10 * 1024 * 1024 })
        if (content.status !== 0) {
          throw new Error('Exact failed creation archive unavailable; nothing was deleted')
        }
        previousFiles.push(`${file}\0${content.stdout.toString('utf8')}`)
      }
      if (createHash('sha256').update(previousFiles.join('\0')).digest('hex') !== environmentVariables(detail).MIP_ADMIN_CERT_CODE_MARKER) {
        throw new Error('Failed creation source marker mismatch; nothing was deleted')
      }
      fs.copyFileSync(failedArchive, path.join(directory, 'before-failed.zip'))
      call('scf', 'DeleteFunction', { FunctionName: config.functionName, Namespace: config.envId })
      for (let attempt = 0; attempt < 15 && getFunction(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (getFunction()) {
        throw new Error('Failed creation removal is still pending; no replacement was created')
      }
      detail = null
    }
    else {
      await downloadArchive('before')
    }
  }
  const staging = path.join(directory, 'package')
  fs.mkdirSync(staging, { recursive: true })
  for (const file of files) {
    fs.copyFileSync(path.join(source, file), path.join(staging, file))
  }
  const archive = path.join(directory, 'function.zip')
  fs.rmSync(archive, { force: true })
  const zipped = spawnSync('zip', ['-q', archive, ...files], { cwd: staging, encoding: 'utf8' })
  if (zipped.status !== 0) {
    throw new Error('Function archive failed')
  }
  const zip = fs.readFileSync(archive).toString('base64')
  const environment = { ...config.environment, MIP_ADMIN_CERT_CODE_MARKER: marker }
  const configuration = { FunctionName: config.functionName, Namespace: config.envId, Description: 'Daily MIP admin free certificate renewal; no MySQL', MemorySize: 128, Timeout: 60, Role: config.roleName, ClsLogsetId: config.logsetId, ClsTopicId: config.logTopicId, Environment: { Variables: Object.entries(environment).map(([Key, Value]) => ({ Key, Value })) } }
  if (!detail) {
    privateJson('create.private.json', call('scf', 'CreateFunction', { ...configuration, Code: { ZipFile: zip }, CodeSource: 'ZipFile', Handler: 'index.main', InstallDependency: 'TRUE', Runtime: 'Nodejs20.19', Type: 'Event' }, 120000))
  }
  else {
    call('scf', 'UpdateFunctionConfiguration', configuration)
    await waitActive()
    call('scf', 'UpdateFunctionCode', { FunctionName: config.functionName, Namespace: config.envId, Handler: 'index.main', ZipFile: zip, InstallDependency: 'TRUE', CodeSource: 'ZipFile' }, 120000)
  }
  detail = await waitActive()
  assertDetail(detail)
  if (canonicalJson(environmentVariables(detail)) !== canonicalJson(environment)) {
    throw new Error('Runtime environment readback failed')
  }
  disableClientInvocation()
  const { archive: deployedArchive, codeSha256 } = await downloadArchive('deployed')
  for (const file of files) {
    const content = spawnSync('unzip', ['-p', deployedArchive, file], { maxBuffer: 10 * 1024 * 1024 })
    if (content.status !== 0 || !content.stdout.equals(fs.readFileSync(path.join(source, file)))) {
      throw new Error('Deployed runtime source mismatch')
    }
  }
  privateJson('function-after.private.json', detail)
  fs.rmSync(path.join(directory, 'canary.private.json'), { force: true })
  console.log(JSON.stringify({ ...report, status: 'DEPLOYED_VERIFIED', matchingFiles: files.length, codeSha256 }))
}
else {
  if (!detail) {
    throw new Error('Deploy the dedicated certificate function first')
  }
  assertDetail(detail)
  const triggers = listTriggers()
  if (command === 'pause') {
    if (triggers[0]) {
      setTrigger(renewalCron(triggers[0].TriggerDesc), 'CHECK', 'CLOSE')
    }
    console.log(JSON.stringify({ ...report, status: 'TIMER_PAUSED_VERIFIED' }))
  }
  else if (command === 'canary') {
    if (triggers.some(trigger => normalizeTriggerEnable(trigger.Enable) !== 'CLOSE')) {
      throw new Error('An enabled timer already exists; verify it before replacing')
    }
    const offset = Number(env.MIP_SCF_TIMER_UTC_OFFSET_MINUTES)
    if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
      throw new Error('SCF timer offset must be explicitly configured')
    }
    const fireAt = new Date(Date.now() + 120000)
    setTrigger(oneShotCron(fireAt, offset), 'CANARY')
    privateJson('canary.private.json', { generation: config.generation, fireAt: fireAt.toISOString(), offset })
    console.log(JSON.stringify({ ...report, status: 'CANARY_SCHEDULED', fireAt: fireAt.toISOString() }))
  }
  else if (command === 'activate') {
    const canaryPath = path.join(directory, 'canary.private.json')
    if (!fs.existsSync(canaryPath)) {
      throw new Error('Run a timer canary before activation')
    }
    const canary = JSON.parse(fs.readFileSync(canaryPath, 'utf8'))
    const state = await readState()
    if (canary.generation !== config.generation || state?.lastCanary?.generation !== config.generation || state.lastCanary.guard !== 'COS_CREATE_ONLY'
      || Date.parse(state.lastCanary.checkedAt) < Date.parse(canary.fireAt) - 5000 || Date.parse(canary.fireAt) > Date.now()) {
      throw new Error('Actual timer canary has not been verified')
    }
    // SCF cron local time was proved by the one-shot canary; run at 03:17 UTC.
    const minutes = ((197 + canary.offset) % 1440 + 1440) % 1440
    setTrigger(`0 ${minutes % 60} ${Math.floor(minutes / 60)} * * * *`, 'CHECK')
    privateJson('state.private.json', state)
    console.log(JSON.stringify({ ...report, status: 'DAILY_ENABLED', canaryVerifiedAt: state.lastCanary.checkedAt, scheduleUtc: '03:17 daily' }))
  }
  else if (command === 'check' || command === 'force') {
    if (command === 'force' && argument('confirm-free-issuance') !== domain) {
      throw new Error('Force issues one real free certificate; exact domain confirmation required')
    }
    const value = unwrap(call('scf', 'Invoke', { FunctionName: config.functionName, Namespace: config.envId, InvocationType: 'RequestResponse', ClientContext: JSON.stringify(signRequest(config, { mode: command === 'force' ? 'FORCE' : 'CHECK', timestamp: Date.now() })) }))
    privateJson('invoke.private.json', value)
    const result = typeof value.Result === 'object' ? value.Result : value
    let output
    try {
      output = JSON.parse(result.RetMsg)
    }
    catch {
      throw new Error('Function result unavailable; inspect private invocation evidence')
    }
    if (!output.ok) {
      throw new Error('Certificate invocation failed; inspect private invocation evidence')
    }
    console.log(JSON.stringify({ ...report, ...output.data }))
  }
  else {
    const state = await readState()
    privateJson('state.private.json', state)
    console.log(JSON.stringify({ ...report, status: 'READBACK', triggers: triggers.map(({ TriggerName, TriggerDesc, Enable }) => ({ TriggerName, TriggerDesc, Enable })), lastCheck: state?.lastCheck, lastCanary: state?.lastCanary, lastSuccess: state?.lastSuccess, pending: Boolean(state?.pending), reconciliationRequired: Boolean(state?.applying) }))
  }
}

function getFunction() {
  try {
    return functionDetail(call('scf', 'GetFunction', { FunctionName: 'mip-admin-cert-renewer', Namespace: env.CLOUDBASE_ENV_ID, ShowCode: 'FALSE' }))
  }
  catch (error) {
    if (/not found|not exist|resourcenotfound/i.test(error.message)) {
      return null
    }
    throw error
  }
}
function verifyRole() {
  const file = argument('verified-role-file')
  if (file) {
    const resolved = path.resolve(file)
    if (path.dirname(resolved) !== directory || !resolved.endsWith('.private.json')) {
      throw new Error('CAM console evidence must stay in the dedicated private directory')
    }
    assertRenewalRoleEvidence(config, JSON.parse(fs.readFileSync(resolved, 'utf8')))
    return
  }
  ensureRenewalRole(config, (action, params) => call('cam', action, params), { allowLogPermissions: command === 'role' && argument('confirm-log-permission') === domain, allowClaimPermissions: command === 'role' && argument('confirm-claim-permission') === domain, allowCertificateDetail: command === 'role' && argument('confirm-certificate-detail-permission') === domain, previousLogTopicId: info.LogServices?.[0]?.TopicId })
}
function assertDetail(value) {
  const variables = environmentVariables(value)
  if (value.FunctionName !== config.functionName || value.Role !== config.roleName || value.Runtime !== 'Nodejs20.19' || value.Type !== 'Event'
    || value.VpcConfig?.VpcId || value.VpcConfig?.SubnetId || value.MemorySize !== 128 || value.Timeout !== 60) {
    throw new Error('Dedicated function configuration drifted')
  }
  if (value.Status === 'Active' && (value.ClsTopicId !== config.logTopicId || value.ClsLogsetId !== config.logsetId)) {
    throw new Error('Dedicated log binding drifted')
  }
  readConfig(variables)
  if (canonicalJson(variables) !== canonicalJson({ ...config.environment, MIP_ADMIN_CERT_CODE_MARKER: variables.MIP_ADMIN_CERT_CODE_MARKER })
    || !/^[a-f0-9]{64}$/.test(variables.MIP_ADMIN_CERT_CODE_MARKER || '')) {
    throw new Error('Unexpected runtime environment or secrets')
  }
}
async function waitActive() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = getFunction()
    if (value?.Status === 'Active') {
      return value
    }
    if (/Failed|Error/.test(value?.Status || '')) {
      privateJson('function-failed.private.json', value)
      throw new Error('Dedicated function activation failed')
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error('Dedicated function activation timed out')
}
async function downloadArchive(label) {
  const address = unwrap(call('scf', 'GetFunctionAddress', { FunctionName: config.functionName, Namespace: config.envId }))
  privateJson(`${label}-address.private.json`, address)
  const response = await fetch(address.Url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) {
    throw new Error('Function code readback download failed')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== address.CodeSha256) {
    throw new Error('Function archive SHA-256 mismatch')
  }
  const archive = path.join(directory, `${label}.zip`)
  fs.writeFileSync(archive, bytes, { mode: 0o600 })
  return { archive, codeSha256: address.CodeSha256 }
}
function listTriggers() {
  const result = triggerList(call('scf', 'ListTriggers', { FunctionName: config.functionName, Namespace: config.envId, Limit: 100, Offset: 0 }))
  if (result.length > 1 || result.some(item => item.TriggerName !== config.triggerName || item.Type.toLowerCase() !== 'timer' || item.Qualifier !== '$DEFAULT')) {
    throw new Error('Unexpected dedicated function trigger')
  }
  return result
}
function setTrigger(cron, mode, enable = 'OPEN') {
  const trigger = listTriggers()[0]
  const message = JSON.stringify(signRequest(config, { mode }))
  call('scf', trigger ? 'UpdateTrigger' : 'CreateTrigger', { FunctionName: config.functionName, Namespace: config.envId, TriggerName: config.triggerName, Type: 'timer', TriggerDesc: cron, CustomArgument: message, Qualifier: '$DEFAULT', Enable: enable })
  const actual = listTriggers()[0]
  if (normalizeTriggerEnable(actual?.Enable) !== enable || renewalCron(actual.TriggerDesc) !== cron || actual.CustomArgument !== message) {
    throw new Error('Timer readback failed')
  }
  privateJson('trigger.private.json', actual)
}
function disableClientInvocation() {
  const query = () => callCloudbase(root, 'queryPermissions', { action: 'getResourcePermission', resourceType: 'function', resourceId: config.functionName })
  const before = parseFunctionSecurityRules(query()?.data?.permissions?.[0]?.SecurityRule)
  callCloudbase(root, 'managePermissions', { action: 'updateResourcePermission', resourceType: 'function', resourceId: config.functionName, permission: 'CUSTOM', securityRule: JSON.stringify(updateMipFunctionInvocationRule(before, config.functionName, false)) })
  assertFunctionSecurityRulesConverged({ before, after: parseFunctionSecurityRules(query()?.data?.permissions?.[0]?.SecurityRule), functionName: config.functionName, invoke: false })
}
async function readState() {
  const auth = callCloudbase(root, 'auth', { action: 'get_temp_credentials', confirm: 'yes', reveal: true }, 30000)
  const credentials = auth.credentials
  if (!credentials?.token) {
    throw new Error('Temporary management credentials unavailable')
  }
  const COS = require('cos-nodejs-sdk-v5')
  const client = new COS({ SecretId: credentials.secretId, SecretKey: credentials.secretKey, SecurityToken: credentials.token })
  return new Promise((resolve, reject) => client.getObject({ Bucket: config.stateBucket, Region: config.region, Key: `mip/operations/admin-cert-renewal/${config.domain}/state.json` }, (error, result) => {
    if (error?.code === 'NoSuchKey' || error?.statusCode === 404) {
      resolve(null)
    }
    else if (error) {
      reject(new Error(`State readback failed: ${error.code || 'COS_ERROR'}`))
    }
    else {
      try {
        resolve(JSON.parse(String(result.Body)))
      }
      catch {
        reject(new Error('State JSON invalid'))
      }
    }
  }))
}
